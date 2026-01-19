//music-vault-server/src/scripts/harvest_metadata.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

// --- CONFIGURACIÓN ---
const WAIT_MS = 1000; // Pausa obligatoria entre artistas (1s)
const BATCH_SIZE = 1; // Procesamos de 1 en 1 para máxima seguridad

async function main() {
  console.log("🚜 INICIANDO COSECHA MASIVA DE METADATOS (Artistas + Álbumes)...");

  // 0. Asegurar tablas (por si acaso)
  db.run(`CREATE TABLE IF NOT EXISTS artists (id TEXT PRIMARY KEY, name TEXT NOT NULL, tidal_id TEXT UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  db.run(`CREATE TABLE IF NOT EXISTS albums (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist_id TEXT NOT NULL, tidal_id TEXT, image_url TEXT, FOREIGN KEY(artist_id) REFERENCES artists(id));`);
  db.run("CREATE INDEX IF NOT EXISTS idx_artist_name ON artists(name);");

  // 1. Obtener lista de Artistas que AÚN NO están en nuestra tabla 'artists'
  // Esto hace que el script sea "reanudable". Si se corta, sigue con los que faltan.
  const artistsToDo = db.prepare(`
    SELECT DISTINCT artist_name 
    FROM play_history 
    WHERE artist_name IS NOT NULL 
      AND artist_name != ''
      AND artist_name NOT IN (SELECT name FROM artists)
    ORDER BY artist_name ASC
  `).all() as { artist_name: string }[];

  console.log(`🎯 Objetivo: ${artistsToDo.length} artistas nuevos por procesar.`);

  // Statements preparados para velocidad
  const insertArtist = db.prepare("INSERT OR IGNORE INTO artists (id, name, tidal_id) VALUES (?, ?, ?)");
  const insertAlbum = db.prepare("INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url) VALUES (?, ?, ?, ?, ?)");
  const checkAlbum = db.prepare("SELECT id FROM albums WHERE title = ? AND artist_id = ?");

  let processed = 0;
  let found = 0;
  let notFound = 0;

  // Bucle Principal
  for (const item of artistsToDo) {
    const artistName = item.artist_name.trim();
    
    // Barra de progreso simple
    const progress = ((processed / artistsToDo.length) * 100).toFixed(2);
    process.stdout.write(`\r🚀 ${progress}% | ✅ Found: ${found} | ❌ 404: ${notFound} | 🔎 Buscando: ${artistName.substring(0, 20)}...`);

    try {
      // --- PASO A: BUSCAR ARTISTA ---
      // Usamos encodeURIComponent para nombres con espacios o tildes
      const encodedName = encodeURIComponent(artistName);
      
      // Función auxiliar para reintentos en caso de 429
      const getCandidates = async () => {
        try {
            return await tidal['api'].get(`/v2/searchResults/${encodedName}/relationships/artists`, {
                params: { countryCode: "PE", limit: 3 }
            });
        } catch (err: any) {
            if (err.response?.status === 429) throw err; // Pasamos el 429 arriba para manejarlo en el loop
            return { data: { data: [] } }; // Si es otro error, retornamos vacío
        }
      };

      let searchRes;
      try {
        searchRes = await getCandidates();
      } catch (err: any) {
         if (err.response?.status === 429) {
             process.stdout.write(`\n⏳ Rate Limit (429). Durmiendo 15s... `);
             await new Promise(r => setTimeout(r, 15000));
             searchRes = await getCandidates(); // Reintento único
         } else {
             searchRes = { data: { data: [] } };
         }
      }

      const candidates = searchRes.data.data || [];
      let tidalArtistId = null;

      if (candidates.length > 0) {
        // Necesitamos verificar los nombres exactos
        const candidateIds = candidates.map((c: any) => c.id).join(",");
        
        let detailsRes;
        try {
            detailsRes = await tidal['api'].get(`/v2/artists`, {
                params: { "filter[id]": candidateIds, countryCode: "PE" }
            });
        } catch (err: any) {
            if (err.response?.status === 429) {
                process.stdout.write(`\n⏳ Rate Limit en detalles. Durmiendo 15s... `);
                await new Promise(r => setTimeout(r, 15000));
                // Reintento
                detailsRes = await tidal['api'].get(`/v2/artists`, {
                    params: { "filter[id]": candidateIds, countryCode: "PE" }
                });
            } else {
                throw err;
            }
        }

        const realCandidates = detailsRes.data.data;
        // Filtro estricto (Case insensitive)
        const match = realCandidates.find((c: any) => c.attributes.name.toLowerCase() === artistName.toLowerCase());
        
        if (match) tidalArtistId = match.id;
      }

      // Guardar resultado del artista
      const myArtistUUID = randomUUID();
      if (tidalArtistId) {
        insertArtist.run(myArtistUUID, artistName, tidalArtistId);
        found++;
      } else {
        // Guardamos con NULL para no volver a buscarlo
        insertArtist.run(myArtistUUID, artistName, null);
        notFound++;
        processed++;
        await new Promise(r => setTimeout(r, 200)); // Pequeña pausa
        continue; // Si no hay artista, no hay álbumes
      }

      // --- PASO B: TRAER ÁLBUMES ---
      // Solo si encontramos el ID de Tidal
      try {
          const albumRes = await tidal['api'].get(`/v2/artists/${tidalArtistId}`, {
              params: { countryCode: "PE", include: "albums" }
          });
          
          const included = albumRes.data.included || [];
          const tidalAlbums = included.filter((x: any) => x.type === "albums");

          const transaction = db.transaction(() => {
              for (const album of tidalAlbums) {
                  const attr = album.attributes;
                  let coverUrl = null;
                  if (attr.cover) {
                       const path = attr.cover.replace(/-/g, '/'); 
                       coverUrl = `https://resources.tidal.com/images/${path}/640x640.jpg`;
                  }
                  
                  // Evitar duplicados
                  const exists = checkAlbum.get(attr.title, myArtistUUID);
                  if (!exists) {
                      insertAlbum.run(randomUUID(), attr.title, myArtistUUID, album.id, coverUrl);
                  }
              }
          });
          transaction();

      } catch (err: any) {
          if (err.response?.status === 429) {
             console.log(`\n⏳ Rate Limit en álbumes. Saltando descarga de discos para ${artistName}.`);
             // No reintentamos aquí para no complicar, ya tenemos al artista guardado
          }
      }

      processed++;
      // Pausa de seguridad entre artistas
      await new Promise(r => setTimeout(r, WAIT_MS));

    } catch (e: any) {
      console.error(`\n❌ Error inesperado con ${artistName}:`, e.message);
      processed++;
    }
  }

  console.log("\n\n🏁 ¡COSECHA FINALIZADA!");
  console.log(`📊 Resumen:`);
  console.log(`   - Artistas encontrados: ${found}`);
  console.log(`   - No encontrados: ${notFound}`);
}

main();