import db from "../../db";

async function ultraMatcherV2() {
    console.log("🚀 INICIANDO VINCULACIÓN AGRESIVA CON TELEMETRÍA...");

    // 1. Cargamos los huérfanos
    const pending = db.prepare(`
        SELECT id, track_name, artist_name_clean 
        FROM play_history 
        WHERE track_id IS NULL
    `).all() as any[];

    console.log(`🧐 Total a procesar: ${pending.length} registros.`);
    
    let linked = 0;
    let processed = 0;

    // Preparamos la consulta de búsqueda fuera del bucle para máximo rendimiento
    const findTrack = db.prepare(`
        SELECT t.id, t.title 
        FROM tracks t
        JOIN albums alb ON t.album_id = alb.id
        JOIN artists art ON alb.artist_id = art.id
        WHERE art.name_clean = ?
        AND (
            replace(lower(t.title), ' ', '') LIKE ? 
            OR ? LIKE '%' || replace(lower(t.title), ' ', '') || '%'
        )
        LIMIT 1
    `);

    const updatePlay = db.prepare(`UPDATE play_history SET track_id = ? WHERE id = ?`);

    for (const row of pending) {
        processed++;
        const cleanName = row.track_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        
        // Imprimimos progreso cada 50 registros para no saturar la consola pero ver que se mueve
        if (processed % 50 === 0) {
            process.stdout.write(`\r      🔄 Procesado: ${processed}/${pending.length} | Vinculados: ${linked}`);
        }

        try {
            // Buscamos el track
            const match = findTrack.get(row.artist_name_clean, `%${cleanName}%`, cleanName) as { id: string, title: string } | undefined;

            if (match) {
                updatePlay.run(match.id, row.id);
                linked++;
                // Si quieres ver EXACTAMENTE qué está vinculando, descomenta la siguiente línea:
                // console.log(`\n      ✅ MATCH: "${row.track_name}" -> "${match.title}"`);
            }
        } catch (e) {
            console.log(`\n      ❌ Error en registro ${processed}: ${e.message}`);
        }
    }

    console.log(`\n\n✅ PROCESO FINALIZADO.`);
    console.log(`📈 Se vincularon ${linked} reproducciones de ${processed} analizadas.`);
}

ultraMatcherV2();   