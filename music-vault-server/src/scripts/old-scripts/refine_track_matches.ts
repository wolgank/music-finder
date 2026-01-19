import db from "../../db";

// Función para limpiar nombres de canciones y facilitar el match
function cleanTrackName(name: string): string {
    if (!name) return "";
    return name.toLowerCase()
        .replace(/\(.*\)/g, "") // Quita todo lo que esté entre paréntesis (Remaster, Live, etc)
        .replace(/ - .*/g, "")  // Quita todo lo que venga después de un guión largo
        .replace(/deluxe|remaster|edition|version|feat\.|live|radio edit|2007|2015/g, "")
        .replace(/[^a-z0-9]/g, "") // Deja solo letras y números
        .trim();
}

async function refineMatches() {
    console.log("🎯 INICIANDO REFINAMIENTO DE VINCULACIÓN...");

    // 1. Buscamos canciones ÚNICAS en el historial que NO tienen track_id pero cuyo ÁLBUM sí existe
    const pendingMatches = db.prepare(`
        SELECT DISTINCT ph.track_name, ph.album_name_clean, ph.artist_name_clean, alb.id as local_album_id
        FROM play_history ph
        JOIN albums alb ON ph.album_name_clean = alb.title_clean
        JOIN artists art ON alb.artist_id = art.id AND ph.artist_name_clean = art.name_clean
        WHERE ph.track_id IS NULL
    `).all() as any[];

    console.log(`🧐 Analizando ${pendingMatches.length} canciones únicas con posible match...`);

    let fixedCount = 0;

    db.transaction(() => {
        for (const item of pendingMatches) {
            const cleanHistoryName = cleanTrackName(item.track_name);
            
            // Buscamos en nuestra tabla 'tracks' (donde están los 70k) 
            // alguna canción que pertenezca a ese mismo álbum
            const possibleTracks = db.prepare(`
                SELECT id, title FROM tracks WHERE album_id = ?
            `).all(item.local_album_id) as { id: string, title: string }[];

            // Buscamos un match con el nombre limpio
            const match = possibleTracks.find(t => cleanTrackName(t.title) === cleanHistoryName);

            if (match) {
                // Actualizamos todas las repeticiones en el historial de una sola vez
                const update = db.prepare(`
                    UPDATE play_history 
                    SET track_id = ? 
                    WHERE track_name = ? 
                    AND album_name_clean = ? 
                    AND artist_name_clean = ?
                `).run(match.id, item.track_name, item.album_name_clean, item.artist_name_clean);
                
                fixedCount += update.changes;
            }
        }
    })();

    console.log(`✅ ¡Éxito! Se vincularon ${fixedCount} reproducciones adicionales.`);
}

refineMatches();