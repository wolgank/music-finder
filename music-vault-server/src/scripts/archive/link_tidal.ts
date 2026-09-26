//music-vault-server/src/scripts/link_tidal.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

// --- CONFIGURACIÓN ---
const CONCURRENCY = 3;  // Hilos simultáneos (Bajamos a 3 para ir seguros)
const WAIT_MS = 600;    // Pausa entre lotes (Evitar bloqueo de API)

const tidal = new TidalClient(
  process.env.TIDAL_CLIENT_ID!,
  process.env.TIDAL_CLIENT_SECRET!
);

async function main() {
  console.log("🔗 INICIANDO VINCULACIÓN MASIVA (Modelo Hub & Spoke)...");
  console.log("-------------------------------------------------------");

  // 1. OBTENER CANDIDATOS DEL HISTORIAL
  // Buscamos canciones únicas en play_history que NO hayan sido procesadas aún.
  // La columna 'processed' la creamos en la migración.
  const query = `
    SELECT 
      artist_name, 
      track_name, 
      COUNT(*) as plays 
    FROM play_history 
    WHERE processed = 0 OR processed IS NULL
    GROUP BY artist_name, track_name 
    ORDER BY plays DESC
  `;

  const uniqueTracks = db.prepare(query).all() as { artist_name: string, track_name: string, plays: number }[];
  
  if (uniqueTracks.length === 0) {
      console.log("✅ ¡Todo el historial ya ha sido procesado! No hay nada nuevo.");
      return;
  }

  console.log(`🎯 Se encontraron ${uniqueTracks.length} canciones únicas pendientes de vincular.`);

  // 2. PREPARAR SENTENCIAS SQL (Statements)
  const insertMaster = db.prepare(`
    INSERT INTO library_tracks (id, title, artist, album, duration_seconds, isrc, image_url, explicit)
    VALUES ($id, $title, $artist, $album, $duration, $isrc, $image, $explicit)
  `);

  const insertLink = db.prepare(`
    INSERT INTO platform_links (track_id, platform, external_id, url)
    VALUES ($trackId, 'tidal', $extId, $url)
  `);

  const markAsProcessed = db.prepare(`
    UPDATE play_history 
    SET processed = 1 
    WHERE track_name = $name AND artist_name = $artist
  `);

  // Contadores
  let processedCount = 0;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  // 3. FUNCIÓN DE PROCESAMIENTO POR LOTE
  const processBatch = async (batch: typeof uniqueTracks) => {
    const promises = batch.map(async (item) => {
        // A. Limpieza de Nombre (Clave para encontrar matches)
        const cleanTrack = item.track_name
            .replace(/ - Remastered.*| - \d{4} Remaster.*/g, "")
            .replace(/\(feat\..*\)/g, "")
            .replace(/ - Live.*/g, "")
            .trim();

        // B. Verificar duplicados (Si ya existe en library_tracks con mismo nombre/artista)
        // Esto evita crear 2 UUIDs para la misma canción si ya la procesamos en otra ejecución
        const existing = db.prepare(
            "SELECT id FROM library_tracks WHERE title = ? AND artist = ?"
        ).get(cleanTrack, item.artist_name) as { id: string } | undefined;

        if (existing) {
            // Ya existe en la maestra -> Solo marcamos como procesado en historial
            markAsProcessed.run({ $name: item.track_name, $artist: item.artist_name });
            skippedCount++;
            processedCount++;
            return;
        }

        // C. Buscar en Tidal
        const tidalTrack = await tidal.findExactTrack({
            title: cleanTrack,
            artist: item.artist_name
        });

        // D. Guardar Resultados
        if (tidalTrack) {
            const newUUID = randomUUID();

            // Usamos transacción para garantizar integridad
            const transaction = db.transaction(() => {
                // Insertar Ficha Maestra
                insertMaster.run({
                    $id: newUUID,
                    $title: tidalTrack.name,
                    $artist: tidalTrack.artist,
                    $album: tidalTrack.album,
                    $duration: tidalTrack.duration,
                    $isrc: tidalTrack.isrc,
                    $image: tidalTrack.image,
                    $explicit: tidalTrack.explicit ? 1 : 0
                });

                // Insertar Enlace a Tidal
                insertLink.run({
                    $trackId: newUUID,
                    $extId: tidalTrack.id,
                    $url: tidalTrack.url
                });

                // Marcar en historial como listo
                markAsProcessed.run({ $name: item.track_name, $artist: item.artist_name });
            });

            transaction();
            successCount++;
        } else {
            // No encontrado: Solo marcamos procesado para no buscarla eternamente
            // (Opcional: podrías marcarla con un flag 'not_found' si quisieras reintentar luego)
            markAsProcessed.run({ $name: item.track_name, $artist: item.artist_name });
            failCount++;
        }
        processedCount++;
    });

    await Promise.all(promises);
  };

  // 4. BUCLE PRINCIPAL
  for (let i = 0; i < uniqueTracks.length; i += CONCURRENCY) {
    const batch = uniqueTracks.slice(i, i + CONCURRENCY);
    await processBatch(batch);

    // Barra de progreso
    const percent = ((processedCount / uniqueTracks.length) * 100).toFixed(1);
    process.stdout.write(`\r🚀 ${percent}% | ✅ Match: ${successCount} | ⏭️  Ya estaba: ${skippedCount} | ❌ No: ${failCount} | Track: ${batch[0].track_name.substring(0, 15)}...`);
    
    // Descanso
    await new Promise(r => setTimeout(r, WAIT_MS));
  }

  console.log("\n\n🏁 ¡PROCESO FINALIZADO!");
  console.log(`📊 Resumen:`);
  console.log(`   - Nuevas canciones guardadas: ${successCount}`);
  console.log(`   - Duplicados saltados: ${skippedCount}`);
  console.log(`   - No encontradas en Tidal: ${failCount}`);
}

main();