import db from "../../db";

function showTopMissing() {
    console.log("📊 TOP ARTISTAS CON CANCIONES SIN ÁLBUM");
    console.log("------------------------------------------");

    const topMissing = db.prepare(`
        SELECT ph.artist_name, COUNT(*) as failures
        FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND NOT EXISTS (
            SELECT 1 FROM albums alb 
            JOIN artists art ON alb.artist_id = art.id
            WHERE alb.title_clean = ph.album_name_clean 
            AND art.name_clean = ph.artist_name_clean
        )
        GROUP BY ph.artist_name
        ORDER BY failures DESC
        LIMIT 20
    `).all() as { artist_name: string, failures: number }[];

    topMissing.forEach((a, i) => {
        console.log(`${(i + 1).toString().padEnd(2)} | ${a.artist_name.padEnd(25)} | ❌ ${a.failures} fallos`);
    });
    
    console.log("------------------------------------------");
    console.log("💡 RECOMENDACIÓN: Busca el ID de Tidal de estos artistas y usa 'manual_fix_orphans.ts'");
}

showTopMissing();