//music-vault-server/src/scripts/test_kate_bush.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const CHUNK_SIZE = 10; // 🛡️ El fix anti-error 400

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

async function getRandomSafeArtist() {
    // 1. Tomamos candidatos al azar que tengan ID
    const candidates = db.prepare(`
        SELECT id, name, tidal_id 
        FROM artists 
        WHERE tidal_id IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 20
    `).all() as { id: string, name: string, tidal_id: string }[];

    for (const artist of candidates) {
        // Validación rápida de seguridad (Historial vs DB Local)
        const historyAlbums = db.prepare(`
            SELECT album_name FROM play_history 
            WHERE artist_name = ? AND album_name IS NOT NULL
            LIMIT 5
        `).all(artist.name) as { album_name: string }[];

        if (historyAlbums.length === 0) continue;

        const localAlbums = db.prepare(`SELECT title FROM albums WHERE artist_id = ?`).all(artist.id) as { title: string }[];
        
        const cleanLocals = localAlbums.map(a => cleanString(a.title));
        
        for (const h of historyAlbums) {
            const cleanH = cleanString(h.album_name);
            if (cleanLocals.some(l => l.includes(cleanH) || cleanH.includes(l))) {
                return artist; // ¡Encontrado uno seguro!
            }
        }
    }
    return null;
}

async function testRandomFix() {
  console.log("🎲 BUSCANDO UN 'KATE BUSH' ALEATORIO (ARTISTA SEGURO)...");
  
  const artist = await getRandomSafeArtist();

  if (!artist) {
      console.error("❌ No se encontró ningún artista seguro en la muestra aleatoria. Intenta de nuevo.");
      return;
  }

  console.log(`\n🎯 Objetivo Seleccionado: \x1b[36m${artist.name}\x1b[0m (ID: ${artist.tidal_id})`);
  console.log("-------------------------------------------------------");

  // --- FASE 1: PAGINACIÓN (Encontrar todos los IDs) ---
  console.log("📡 Fase 1: Escaneando catálogo completo (Paginación)...");
  
  let allAlbumIds: string[] = [];
  let nextCursor: string | null = null;
  let hasMore = true;
  let pageCount = 0;

  try {
      while (hasMore) {
          const params: any = { countryCode: "PE", limit: 100 };
          if (nextCursor) params["page[cursor]"] = nextCursor;

          const res = await tidal['api'].get(`/v2/artists/${artist.tidal_id}/relationships/albums`, { params });
          const data = res.data.data || [];
          const ids = data.map((item: any) => item.id);
          allAlbumIds.push(...ids);
          
          process.stdout.write(`   ➡️  Página ${pageCount + 1}: ${data.length} álbumes. `);
          
          nextCursor = res.data.links?.meta?.nextCursor;
          if (nextCursor) {
              console.log(`(Siguiente...)`);
          } else {
              console.log("(Fin)");
              hasMore = false;
          }
          pageCount++;
          await sleep(200);
      }
  } catch (e: any) {
      console.error("\n❌ Error en paginación:", e.message);
      return;
  }

  console.log(`✅ Total de álbumes encontrados en Tidal: ${allAlbumIds.length}`);

  // --- FASE 2: DETECCIÓN DE HUECOS ---
  const currentAlbums = db.prepare(`SELECT tidal_id FROM albums WHERE artist_id = ?`).all(artist.id) as { tidal_id: string }[];
  const currentIds = new Set(currentAlbums.map(a => a.tidal_id));
  
  const missingIds = allAlbumIds.filter(id => !currentIds.has(id));

  console.log(`📊 En tu DB tenías: ${currentAlbums.length}`);
  console.log(`🆕 Faltaban por descargar: ${missingIds.length}`);

  if (missingIds.length === 0) {
      console.log("\n✨ Este artista ya estaba completo. ¡Prueba otro!");
      return;
  }

  // --- FASE 3: DESCARGA SEGURA (Lotes de 10) ---
  console.log("\n📡 Fase 2: Descargando los faltantes (Lotes de 10)...");
  
  const insertAlbum = db.prepare("INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url) VALUES (?, ?, ?, ?, ?)");
  let savedCount = 0;

  for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
      const chunk = missingIds.slice(i, i + CHUNK_SIZE);
      const idsString = chunk.join(",");

      try {
          process.stdout.write(`   📦 Lote ${Math.ceil((i + 1) / CHUNK_SIZE)}: `);
          
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
          console.log(`Guardados ${albumsData.length} ítems. OK.`);

      } catch (e: any) {
          console.error(`❌ Error: ${e.message}`);
          if (e.response?.status === 400) console.error("      (Aún da error 400, necesitamos bajar más el lote?)");
      }
      await sleep(200);
  }

  console.log("-------------------------------------------------------");
  console.log(`🏆 PRUEBA FINALIZADA.`);
  console.log(`   Artista: ${artist.name}`);
  console.log(`   Álbumes nuevos añadidos: ${savedCount}`);
}

testRandomFix();