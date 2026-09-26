import db from '../db';
import * as fs from 'fs';
import { LIBRARY_INDEX_PATH } from '../paths';

async function updateIndex() {
    console.log("🔍 Sincronizando music_mappings.json con la Base de Datos...");

    // 1. Cargar fuentes de datos
    const mappings = JSON.parse(fs.readFileSync('music_mappings.json', 'utf-8'));
    const decisions = JSON.parse(fs.readFileSync('cleanup_decisions.json', 'utf-8'));

    // 2. Preparar sets de búsqueda rápida de la DB (IDs y Nombres)
    const dbArtists = db.prepare("SELECT id, name FROM artists").all() as any[];
    const dbAlbums = db.prepare("SELECT id, title, artist_id FROM albums").all() as any[];
    const dbTracks = db.prepare("SELECT id, title, album_id FROM tracks").all() as any[];

    // Mapeos para verificar existencia por nombre (normalizado simple para el match)
    const artistNameMap = new Map(dbArtists.map(a => [a.name.toLowerCase().trim(), a.id]));
    const albumNameMap = new Map(dbAlbums.map(a => [`${a.artist_id}|${a.title.toLowerCase().trim()}`, a.id]));

    // Artistas marcados como inexistentes
    const nonExistentArtists = new Set(decisions.non_existent_on_tidal.map((x: any) => x.artist_name.toLowerCase().trim()));

    const libraryIndex = mappings.map((m: any) => {
        const history = m.history;
        const links = { ...m.links };
        
        const artistNameNorm = history.artist_name.toLowerCase().trim();
        const isNonExistent = nonExistentArtists.has(artistNameNorm);

        // --- LÓGICA DE ARTISTA ---
        if (isNonExistent) {
            links.artist_id = "NO EXISTE";
        } else if (!links.artist_id) {
            links.artist_id = artistNameMap.get(artistNameNorm) || null;
        }

        // --- LÓGICA DE ÁLBUM ---
        if (isNonExistent) {
            links.album_id = "NO EXISTE";
        } else if (!links.album_id && links.artist_id && links.artist_id !== "NO EXISTE") {
            // Buscamos el álbum en la DB que pertenezca a ese artista
            const albumKey = `${links.artist_id}|${history.album_name.toLowerCase().trim()}`;
            links.album_id = albumNameMap.get(albumKey) || null;
        } else if (isNonExistent) {
            links.album_id = "NO EXISTE";
        }

        // --- LÓGICA DE CANCIÓN ---
        if (isNonExistent) {
            links.track_id = "NO EXISTE";
        } else if (!links.track_id && links.album_id && links.album_id !== "NO EXISTE") {
            // Verificamos si la canción existe en ese álbum en la DB
            const track = db.prepare("SELECT id FROM tracks WHERE album_id = ? AND title LIKE ?")
                            .get(links.album_id, history.track_name) as any;
            links.track_id = track ? track.id : null;
        }

        return {
            history: m.history,
            links: links,
            match_confidence: m.match_confidence,
            status: isNonExistent ? "DISCARDED" : (links.track_id ? "MAPPED" : "INCOMPLETE")
        };
    });

    // 4. Guardar el nuevo índice
    fs.writeFileSync(LIBRARY_INDEX_PATH, JSON.stringify(libraryIndex, null, 2));

    // Estadísticas
    const total = libraryIndex.length;
    const mapped = libraryIndex.filter((i:any) => i.links.track_id && i.links.track_id !== "NO EXISTE").length;
    const nonExistent = libraryIndex.filter((i:any) => i.links.artist_id === "NO EXISTE").length;
    const missing = total - mapped - nonExistent;

    console.log("\n" + "=".repeat(50));
    console.log(`✅ Índice generado: ${LIBRARY_INDEX_PATH}`);
    console.log(`🎵 Total entradas: ${total}`);
    reportStat("Completadas", mapped, "🟢");
    reportStat("Marcadas como NO EXISTE", nonExistent, "⚪");
    reportStat("Pendientes (NULL)", missing, "🚩");
    console.log("=".repeat(50));
}

function reportStat(label: string, value: number, emoji: string) {
    console.log(`${emoji} ${label.padEnd(25)}: ${value}`);
}

updateIndex();