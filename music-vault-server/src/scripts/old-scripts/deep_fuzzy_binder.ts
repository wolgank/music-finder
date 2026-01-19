import db from "../../db";

function ultraClean(str: string): string {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, "") // Mantenemos espacios para comparar palabras
        .trim();
}

async function deepFuzzyBinder() {
    console.log("🧠 INICIANDO VÍNCULO FUZZY PROFUNDO...");
    
    const pendings = db.prepare(`
        SELECT DISTINCT ph.track_name, ph.album_name, ph.artist_name, alb.id as local_album_id
        FROM play_history ph
        JOIN albums alb ON ph.album_name_clean = alb.title_clean
        JOIN artists art ON alb.artist_id = art.id AND ph.artist_name_clean = art.name_clean
        WHERE ph.track_id IS NULL
    `).all() as any[];

    console.log(`🧐 Analizando ${pendings.length} fallos de nombre con lógica de sub-cadena...`);

    let fixed = 0;
    db.transaction(() => {
        for (const item of pendings) {
            const hTrack = ultraClean(item.track_name);
            const tracksInAlbum = db.prepare(`SELECT id, title FROM tracks WHERE album_id = ?`).all(item.local_album_id) as any[];

            const match = tracksInAlbum.find(t => {
                const dbTrack = ultraClean(t.title);
                // Si el nombre del historial está contenido en el de la DB o viceversa
                return dbTrack.includes(hTrack) || hTrack.includes(dbTrack) || 
                       (hTrack.length > 5 && dbTrack.length > 5 && (hTrack.startsWith(dbTrack.substring(0, 8))));
            });

            if (match) {
                const res = db.prepare(`
                    UPDATE play_history SET track_id = ? 
                    WHERE track_name = ? AND album_name = ? AND artist_name = ?
                `).run(match.id, item.track_name, item.album_name, item.artist_name);
                fixed += res.changes;
            }
        }
    })();

    console.log(`✅ Se rescataron ${fixed} reproducciones adicionales.`);
}

deepFuzzyBinder();