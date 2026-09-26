import db from "../../db";

function superClean(str: string): string {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\(.*\)|\[.*\]/g, "")
        .replace(/deluxe|remaster|edition|version|feat\.|live|20\d{2}|bonus track|special|expanded/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

async function forceBinding() {
    console.log("🛠️  FORZANDO VINCULACIÓN DE ÁLBUMES DIFUSOS...");
    
    const missing = db.prepare(`
        SELECT DISTINCT ph.album_name, ph.artist_name_clean, ph.album_name_clean
        FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND NOT EXISTS (SELECT 1 FROM albums alb WHERE alb.title_clean = ph.album_name_clean)
    `).all() as any[];

    let fixed = 0;

    db.transaction(() => {
        for (const m of missing) {
            const cleanHAlbum = superClean(m.album_name);

            const possible = db.prepare(`
                SELECT title, title_clean FROM albums 
                WHERE artist_id = (SELECT id FROM artists WHERE name_clean = ?)
            `).all(m.artist_name_clean) as { title: string, title_clean: string }[];

            const match = possible.find(p => {
                const cleanDB = superClean(p.title);
                return cleanDB.includes(cleanHAlbum) || cleanHAlbum.includes(cleanDB);
            });

            if (match) {
                // Corregimos el historial para que use el nombre exacto que tenemos en DB
                db.prepare(`
                    UPDATE play_history 
                    SET album_name = ?, album_name_clean = ?
                    WHERE album_name = ? AND artist_name_clean = ?
                `).run(match.title, match.title_clean, m.album_name, m.artist_name_clean);
                fixed++;
            }
        }
    })();

    console.log(`✅ Se corrigieron ${fixed} nombres de álbumes en el historial.`);
    console.log("Ahora estos álbumes serán detectados por el cosechador de tracks.");
}

forceBinding();