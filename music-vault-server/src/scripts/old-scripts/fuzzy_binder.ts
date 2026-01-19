import db from "../../db";

// Limpieza extrema para matching flexible
function superClean(str: string): string {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Quitar tildes/acentos
        .replace(/\(.*\)|\[.*\]/g, "")   // Quitar contenido en paréntesis o corchetes
        .replace(/deluxe|remaster|edition|version|feat\.|live|radio edit|20\d{2}|bonus track|special|expanded/g, "")
        .replace(/[^a-z0-9]/g, "")       // Solo alfanuméricos
        .trim();
}

async function fuzzyBinder() {
    console.log("🧬 INICIANDO VÍNCULO FUZZY (ÁLBUMES Y TRACKS)...");
    console.log("--------------------------------------------------");

    // 1. Obtener todas las canciones únicas que aún NO tienen track_id
    // pero cuyo ARTISTA sí conocemos (para tener un punto de partida)
    const pendings = db.prepare(`
        SELECT DISTINCT ph.track_name, ph.album_name, ph.artist_name, ph.artist_name_clean
        FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND EXISTS (SELECT 1 FROM artists a WHERE a.name_clean = ph.artist_name_clean)
    `).all() as any[];

    console.log(`🧐 Analizando ${pendings.length} canciones únicas sin vínculo...`);

    let albumsLinked = new Set();
    let tracksFixed = 0;

    db.transaction(() => {
        for (const item of pendings) {
            const cleanHAlbum = superClean(item.album_name);
            const cleanHTrack = superClean(item.track_name);

            // A. Buscar el álbum en la DB para ese artista
            const possibleAlbums = db.prepare(`
                SELECT id, title FROM albums 
                WHERE artist_id = (SELECT id FROM artists WHERE name_clean = ?)
            `).all(item.artist_name_clean) as { id: string, title: string }[];

            const matchedAlbum = possibleAlbums.find(alb => {
                const cleanDBAlb = superClean(alb.title);
                return cleanDBAlb.includes(cleanHAlbum) || cleanHAlbum.includes(cleanDBAlb);
            });

            if (matchedAlbum) {
                albumsLinked.add(matchedAlbum.id);

                // B. Ya tenemos el álbum, ahora buscamos el track dentro de ese álbum
                const possibleTracks = db.prepare(`
                    SELECT id, title FROM tracks WHERE album_id = ?
                `).all(matchedAlbum.id) as { id: string, title: string }[];

                const matchedTrack = possibleTracks.find(t => {
                    const cleanDBTrack = superClean(t.title);
                    return cleanDBTrack.includes(cleanHTrack) || cleanHTrack.includes(cleanDBTrack);
                });

                if (matchedTrack) {
                    // C. Actualizar historial
                    const update = db.prepare(`
                        UPDATE play_history 
                        SET track_id = ? 
                        WHERE track_name = ? 
                        AND album_name = ? 
                        AND artist_name = ?
                    `).run(matchedTrack.id, item.track_name, item.album_name, item.artist_name);
                    
                    if (update.changes > 0) {
                        tracksFixed += update.changes;
                    }
                }
            }
        }
    })();

    console.log("--------------------------------------------------");
    console.log(`✅ PROCESO COMPLETADO:`);
    console.log(`📂 Álbumes identificados: ${albumsLinked.size}`);
    console.log(`🎵 Reproducciones vinculadas: ${tracksFixed.toLocaleString()}`);
    console.log("--------------------------------------------------\n");
    
    console.log("💡 Sugerencia: Corre ahora 'bun src/scripts/unique_audit.ts' para ver el nuevo % de éxito.");
}

fuzzyBinder();