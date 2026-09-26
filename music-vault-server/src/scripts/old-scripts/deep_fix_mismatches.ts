//music-vault-server/src/scripts/deep_fix_mismatches.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const CHUNK_SIZE = 10; // Seguro contra error 400
const WAIT_MS = 200;

// --- UTILIDADES ---
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cleanString(str: string) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/\(.*\)/g, "")
        .replace(/deluxe|remaster|edition|version|feat\.|live/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

async function main() {
  console.log("🛟 INICIANDO RESCATE DE ARTISTAS SOSPECHOSOS...");
  
  // 1. Obtener artistas con ID (Candidatos)
  const candidates = db.prepare(`
    SELECT id, name, tidal_id 
    FROM artists 
    WHERE tidal_id IS NOT NULL
    ORDER BY name ASC
  `).all() as { id: string, name: string, tidal_id: string }[];

  const suspiciousArtists = [];

  console.log("🔍 Identificando artistas incompletos (Falso Negativo)...");

  // --- FASE 1: IDENTIFICAR A LOS "BLINK-182" (Artistas incompletos) ---
  for (const artist of candidates) {
      // Historial
      const historyAlbums = db.prepare(`
          SELECT DISTINCT album_name FROM play_history 
          WHERE artist_name = ? AND album_name IS NOT NULL AND album_name != ''
      `).all(artist.name) as { album_name: string }[];

      if (historyAlbums.length === 0) continue;

      // DB Local actual
      const localAlbums = db.prepare(`SELECT title FROM albums WHERE artist_id = ?`).all(artist.id) as { title: string }[];

      // Verificamos si YA coinciden (Si coinciden, están sanos, los saltamos)
      const cleanLocals = localAlbums.map(a => cleanString(a.title));
      let matchFound = false;

      for (const hAlbum of historyAlbums) {
          const cleanHistory = cleanString(hAlbum.album_name);
          if (cleanLocals.some(l => l.includes(cleanHistory) || cleanHistory.includes(l))) {
              matchFound = true;
              break;
          }
      }

      // SI NO HAY MATCH, ES SOSPECHOSO -> A LA LISTA DE RESCATE
      if (!matchFound) {
          suspiciousArtists.push(artist);
      }
  }

  console.log(`📋 Se encontraron ${suspiciousArtists.length} artistas sospechosos (posiblemente incompletos).`);
  console.log(`🚀 Iniciando descarga TOTAL de sus discografías...`);

  // --- FASE 2: PAGINACIÓN PROFUNDA PARA LOS SOSPECHOSOS ---
  const insertAlbum = db.prepare("INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url) VALUES (?, ?, ?, ?, ?)");
  const checkAlbum = db.prepare("SELECT id FROM albums WHERE tidal_id = ?");

  for (const artist of suspiciousArtists) {
      console.log(`\n🔎 Rescatando: \x1b[33m${artist.name}\x1b[0m (ID: ${artist.tidal_id})`);
      
      let allAlbumIds: string[] = [];
      let nextCursor: string | null = null;
      let hasMore = true;

      // A. OBTENER TODOS LOS IDs
      process.stdout.write("   📄 Paginando: ");
      try {
          while (hasMore) {
              const params: any = { countryCode: "PE", limit: 100 };
              if (nextCursor) params["page[cursor]"] = nextCursor;

              let res;
              try {
                  res = await tidal['api'].get(`/v2/artists/${artist.tidal_id}/relationships/albums`, { params });
              } catch (err: any) {
                  if (err.response?.status === 429) {
                      process.stdout.write("(⏳) ");
                      await sleep(5000);
                      continue; 
                  }
                  // Si da 404, el artista fue borrado de Tidal o el ID estaba mal desde el principio
                  if (err.response?.status === 404) {
                      hasMore = false; 
                      continue;
                  }
                  throw err;
              }

              const data = res.data.data || [];
              const ids = data.map((item: any) => item.id);
              allAlbumIds.push(...ids);
              process.stdout.write(`.${data.length}`);

              nextCursor = res.data.links?.meta?.nextCursor;
              if (!nextCursor || data.length === 0) hasMore = false;
              await sleep(100);
          }
      } catch (e: any) {
          console.error(`Error: ${e.message}`);
          continue;
      }
      
      // B. FILTRAR NUEVOS
      const newIds = allAlbumIds.filter(id => !checkAlbum.get(id));
      
      if (newIds.length === 0) {
          console.log(`   💀 No aparecieron álbumes nuevos. Este artista probablemente sea incorrecto.`);
          continue;
      }

      console.log(` -> Encontrados ${newIds.length} álbumes ocultos.`);

      // C. DESCARGAR DETALLES
      let savedCount = 0;
      for (let i = 0; i < newIds.length; i += CHUNK_SIZE) {
          const chunk = newIds.slice(i, i + CHUNK_SIZE);
          const idsString = chunk.join(",");

          try {
              const detailsRes = await tidal['api'].get(`/v2/albums`, {
                  params: { "filter[id]": idsString, countryCode: "PE" }
              });

              const albumsData = detailsRes.data.data || [];

              const tx = db.transaction(() => {
                  for (const alb of albumsData) {
                      const attr = alb.attributes;
                      let coverUrl = null;
                      if (attr.cover) {
                          const path = attr.cover.replace(/-/g, '/'); 
                          coverUrl = `https://resources.tidal.com/images/${path}/640x640.jpg`;
                      }
                      insertAlbum.run(randomUUID(), attr.title, artist.id, alb.id, coverUrl);
                      savedCount++;
                  }
              });
              tx();
              process.stdout.write(`📦`);

          } catch (e: any) {
              if (e.response?.status === 429) await sleep(5000);
          }
          await sleep(WAIT_MS);
      }
      console.log(`\n   💾 Rescatados: ${savedCount}`);
  }

  console.log("\n🏁 OPERACIÓN DE RESCATE FINALIZADA.");
}

main();