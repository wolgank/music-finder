import db from "../../db";

function runUniqueAudit() {
    console.log("\n📊 AUDITORÍA DE CANCIONES ÚNICAS (9,144 Total)");
    console.log("--------------------------------------------------");

    // Total de canciones únicas (DNI: nombre + artista)
    const totalUnique = db.prepare(`
        SELECT COUNT(DISTINCT track_name || artist_name_clean) as count 
        FROM play_history
    `).get() as { count: number };

    // Canciones únicas ya vinculadas
    const linkedUnique = db.prepare(`
        SELECT COUNT(DISTINCT track_name || artist_name_clean) as count 
        FROM play_history 
        WHERE track_id IS NOT NULL
    `).get() as { count: number };

    // Canciones únicas que fallan porque el álbum no existe en DB
    const noAlbumUnique = db.prepare(`
        SELECT COUNT(DISTINCT ph.track_name || ph.artist_name_clean) as count
        FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND NOT EXISTS (
            SELECT 1 FROM albums alb 
            JOIN artists art ON alb.artist_id = art.id
            WHERE alb.title_clean = ph.album_name_clean 
            AND art.name_clean = ph.artist_name_clean
        )
    `).get() as { count: number };

    const nameMismatch = totalUnique.count - linkedUnique.count - noAlbumUnique.count;
    const progress = ((linkedUnique.count / totalUnique.count) * 100).toFixed(2);

    console.log(`🎵 Canciones Únicas Totales:    ${totalUnique.count}`);
    console.log(`✅ Vinculadas con éxito:        ${linkedUnique.count} (${progress}%)`);
    console.log(`❌ Sin Álbum en DB:             ${noAlbumUnique.count} (Pendientes de ID Tidal)`);
    console.log(`⚠️  Fallo de nombre/etiqueta:    ${nameMismatch} (Aún con álbum, no hubo match)`);
    console.log("--------------------------------------------------\n");
}

runUniqueAudit();