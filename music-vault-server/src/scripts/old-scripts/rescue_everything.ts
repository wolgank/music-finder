import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rescueEverything() {
    console.log("🚀 INICIANDO RESCATE GLOBAL (ALBUMS, EPs, SINGLES)...");

    // Obtenemos los 880 que realmente faltan
    const missing = db.prepare(`
        SELECT DISTINCT album_name, artist_name, artist_name_clean, album_name_clean
        FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND NOT EXISTS (SELECT 1 FROM albums alb WHERE alb.title_clean = ph.album_name_clean)
        AND EXISTS (SELECT 1 FROM artists art WHERE art.name_clean = ph.artist_name_clean)
    `).all() as { album_name: string, artist_name: string, artist_name_clean: string, album_name_clean: string }[];

    console.log(`🔍 Analizando ${missing.length} casos...`);

    for (const item of missing) {
        try {
            console.log(`📡 Buscando catálogo completo para: ${item.album_name} - ${item.artist_name}`);
            
            // Buscamos directamente el término para encontrar el recurso correcto
            const query = `${item.artist_name} ${item.album_name}`;
            const search = await tidal['api'].get(`/v2/searchResults/${encodeURIComponent(query)}/relationships/albums`, {
                params: { countryCode: "US", limit: 5 }
            });

            const results = search.data.data || [];
            
            if (results.length > 0) {
                // Tidal nos devuelve aquí tanto Albums como EPs/Singles si el buscador los matchea
                const bestMatch = results[0]; 
                
                const artist = db.prepare("SELECT id FROM artists WHERE name_clean = ?").get(item.artist_name_clean) as { id: string };

                db.transaction(() => {
                    const newAlbumId = randomUUID();
                    db.prepare(`
                        INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, title_clean) 
                        VALUES (?, ?, ?, ?, ?)
                    `).run(newAlbumId, item.album_name, artist.id, bestMatch.id, item.album_name_clean);
                })();

                console.log(`   ✅ Guardado como ${bestMatch.type}: ${item.album_name}`);
            } else {
                console.log(`   ❌ No se encontró nada para este criterio.`);
            }

            await sleep(250); // Evitar 429
        } catch (e) {
            console.error(`   💥 Error en: ${item.album_name}`);
        }
    }
    console.log("\n🏁 Rescate finalizado. Ahora corre el harvest_all_tracks.");
}

rescueEverything();