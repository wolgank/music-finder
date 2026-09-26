import db from "../../db";

async function targetMissing() {
    console.log("🎯 IDENTIFICANDO ÁLBUMES CRÍTICOS PARA EL MATCH...");

    const missing = db.prepare(`
        SELECT artist_name, album_name, COUNT(*) as occurrences
        FROM play_history
        WHERE track_id IS NULL 
          AND album_name_clean NOT IN (SELECT title_clean FROM albums)
        GROUP BY artist_name, album_name
        ORDER BY occurrences DESC
        LIMIT 20
    `).all() as any[];

    console.log("--------------------------------------------------");
    console.log("TOP 20 ÁLBUMES QUE DEBES APARECER PARA SUBIR EL %");
    console.log("--------------------------------------------------");
    
    missing.forEach((m, i) => {
        console.log(`${i+1}. [${m.occurrences} repros] ${m.artist_name} - ${m.album_name}`);
    });
    console.log("--------------------------------------------------");
}

targetMissing();