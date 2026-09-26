import db from "../../db";

async function finalAudit() {
    console.log("📊 INICIANDO AUDITORÍA FINAL DE INTEGRIDAD...");
    console.log("------------------------------------------");

    // 1. Conteo total de reproducciones en el historial
    const totalHistory = db.prepare("SELECT COUNT(*) as count FROM play_history").get() as { count: number };
    
    // 2. Canciones con vínculo exitoso
    const linked = db.prepare("SELECT COUNT(*) as count FROM play_history WHERE track_id IS NOT NULL").get() as { count: number };

    // 3. Canciones que fallaron porque el ÁLBUM no está en la DB
    const missingAlbum = db.prepare(`
        SELECT COUNT(*) as count FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND NOT EXISTS (
            SELECT 1 FROM albums alb 
            JOIN artists art ON alb.artist_id = art.id
            WHERE alb.title_clean = ph.album_name_clean 
            AND art.name_clean = ph.artist_name_clean
        )
    `).get() as { count: number };

    // 4. Canciones que fallaron porque el ÁLBUM sí está, pero la canción NO (Diferencia de nombres)
    const missingTrackMatch = totalHistory.count - linked.count - missingAlbum.count;

    const percent = ((linked.count / totalHistory.count) * 100).toFixed(2);

    console.log(`✅ CANCIONES VINCULADAS:  ${linked.count.toLocaleString()} (${percent}%)`);
    console.log(`❌ SIN ÁLBUM EN DB:      ${missingAlbum.count.toLocaleString()} (Artistas/Discos no encontrados)`);
    console.log(`⚠️  FALLO DE NOMBRE:      ${missingTrackMatch.toLocaleString()} (El álbum existe, pero el nombre variaba mucho)`);
    console.log("------------------------------------------");
    console.log(`🎵 TOTAL HISTORIAL:      ${totalHistory.count.toLocaleString()}`);

    if (missingTrackMatch > 0) {
        console.log("\n🔍 MUESTRA DE CANCIONES CON FALLO DE NOMBRE (Posibles errores de escritura):");
        const samples = db.prepare(`
            SELECT DISTINCT track_name, album_name, artist_name 
            FROM play_history ph
            WHERE ph.track_id IS NULL
            AND EXISTS (
                SELECT 1 FROM albums alb 
                JOIN artists art ON alb.artist_id = art.id
                WHERE alb.title_clean = ph.album_name_clean 
                AND art.name_clean = ph.artist_name_clean
            )
            LIMIT 10
        `).all() as any[];

        samples.forEach(s => console.log(`   - "${s.track_name}" en el álbum "${s.album_name}"`));
    }
}

finalAudit();