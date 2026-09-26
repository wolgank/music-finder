//music-vault-server/src/scripts/fill_missing_albums.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

// --- CONFIGURACIÓN ---
const CHUNK_SIZE = 10; // 🛡️ BAJO PARA EVITAR ERROR 400 (URL muy larga)
const WAIT_MS = 200;   // Pausa entre llamadas para ser amables con la API

// --- UTILIDADES ---
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cleanString(str: string) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/\(.*\)/g, "") // Quitar (Remastered), (Live), etc.
        .replace(/deluxe|remaster|edition|version|feat\.|live/g, "")
        .replace(/[^a-z0-9]/g, "") // Solo letras y números
        .trim();
}

async function main() {
  console.log("🛡️ INICIANDO COMPLETADO DE ÁLBUMES (V3 - FINAL)...");
  
  // 1. Obtener candidatos (Artistas que ya tienen un ID de Tidal)
  const candidates = db.prepare(`
    SELECT id, name, tidal_id 
    FROM artists 
    WHERE tidal_id IS NOT NULL
    ORDER BY name ASC
  `).all() as { id: string, name: string, tidal_id: string }[];

  console.log(`📊 Analizando ${candidates.length} artistas para verificar seguridad...`);

  const safeArtists = [];

  // --- FASE 1: FILTRADO DE SEGURIDAD ---
  // Solo procesamos artistas donde al menos un álbum del historial coincide con la DB
  for (const artist of candidates) {
      const historyAlbums = db.prepare(`
          SELECT DISTINCT album_name FROM play_history 
          WHERE artist_name = ? AND album_name IS NOT NULL AND album_name != ''
      `).all(artist.name) as { album_name: string }[];

      if (historyAlbums.length === 0) continue;

      const currentLocalAlbums = db.prepare(`
          SELECT title FROM albums WHERE artist_id = ?
      `).all(artist.id) as { title: string }[];

      if (currentLocalAlbums.length === 0) continue;

      const cleanLocals = currentLocalAlbums.map(a => cleanString(a.title));
      let isSafe = false;

      for (const hAlbum of historyAlbums) {
          const cleanHistory = cleanString(hAlbum.album_name);
          if (cleanLocals.some(l => l.includes(cleanHistory) || cleanHistory.includes(l))) {
              isSafe = true;
              break;
          }
      }

      if (isSafe) {
          safeArtists.push(artist);
      }
  }

  console.log(`✅ Se confirmaron ${safeArtists.length} artistas SEGUROS.`);
  console.log(`🚀 Iniciando descarga profunda de discografías...\n`);

  // --- FASE 2: DESCARGA PROFUNDA ---
  const insertAlbum = db.prepare("INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url) VALUES (?, ?, ?, ?, ?)");
  const checkAlbum = db.prepare("SELECT id FROM albums WHERE tidal_id = ?");

  for (const artist of safeArtists) {
      console.log(`🔎 Procesando: \x1b[36m${artist.name}\x1b[0m (ID: ${artist.tidal_id})`);
      
      let allAlbumIds: string[] = [];
      let nextCursor: string | null = null;
      let hasMore = true;

      // A. OBTENER TODOS LOS IDs (Paginando)
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
                      process.stdout.write("(⏳ 429) ");
                      await sleep(10000);
                      continue; 
                  }
                  throw err; // Otro error, saltamos artista
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
          console.error(`\n   ❌ Error paginando: ${e.message}`);
          continue;
      }
      
      console.log(` -> Total IDs en Tidal: ${allAlbumIds.length}`);

      // B. FILTRAR LO QUE YA TENEMOS
      const newIds = allAlbumIds.filter(id => !checkAlbum.get(id));
      
      if (newIds.length === 0) {
          console.log("   ✨ Todo al día.");
          continue;
      }

      console.log(`   ⬇️  Bajando detalles de ${newIds.length} álbumes nuevos...`);

      // C. BAJAR DETALLES EN LOTES PEQUEÑOS (10)
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
              console.error(`\n   ⚠️ Error lote ${i}: ${e.message}`);
              if (e.response?.status === 429) {
                  console.log("   ⏳ Rate Limit. Durmiendo 10s...");
                  await sleep(10000);
                  i -= CHUNK_SIZE; // Reintentar
              }
          }
          await sleep(WAIT_MS);
      }
      console.log(`\n   💾 Guardados: ${savedCount}\n`);
  }

  console.log("🏁 PROCESO FINALIZADO. Tu base de datos ahora es sólida como una roca.");
}

main();