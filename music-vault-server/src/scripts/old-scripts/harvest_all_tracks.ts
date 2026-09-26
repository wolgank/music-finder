import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Función para convertir duraciones ISO8601 (PT3M21S) a milisegundos
function parseDurationToMs(duration: string | number): number {
    if (typeof duration === 'number') return duration * 1000;
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const h = parseInt(match[1] || "0");
    const m = parseInt(match[2] || "0");
    const s = parseInt(match[3] || "0");
    return (h * 3600 + m * 60 + s) * 1000;
}

async function harvest() {
    console.log("🚀 INICIANDO COSECHA HÍBRIDA (V1 + V2 FALLBACK)");
    
    // 1. Identificar álbumes que no tienen canciones
    const pendingAlbums = db.prepare(`
        SELECT alb.id as local_id, alb.tidal_id, alb.title as album_name, 
               alb.title_clean, art.name_clean
        FROM albums alb
        JOIN artists art ON alb.artist_id = art.id
        WHERE (SELECT COUNT(*) FROM tracks WHERE album_id = alb.id) = 0
        LIMIT 500
    `).all() as any[];

    console.log(`✅ Objetivo: ${pendingAlbums.length} álbumes pendientes.`);

    for (let i = 0; i < pendingAlbums.length; i++) {
        const album = pendingAlbums[i];
        process.stdout.write(`📦 [${i + 1}/${pendingAlbums.length}] ${album.album_name.slice(0, 30)}... `);

        let tracks: any[] = [];
        let success = false;

        try {
            // INTENTO 1: PROTOCOLO V2
            const resV2 = await tidal['api'].get(`/v2/albums/${album.tidal_id}/relationships/items`, {
                params: { countryCode: "US", include: "items" }
            });
            
            if (resV2.data.included) {
                tracks = resV2.data.included
                    .filter((item: any) => item.type === "tracks")
                    .map((item: any) => ({
                        id: item.id,
                        title: item.attributes.title,
                        duration_ms: parseDurationToMs(item.attributes.duration)
                    }));
                success = true;
            }
        } catch (e) {
            // FALLBACK: PROTOCOLO V1
            try {
                const resV1 = await tidal['api'].get(`/v1/albums/${album.tidal_id}/tracks`, {
                    params: { countryCode: "US" }
                });
                tracks = (resV1.data.items || []).map((t: any) => ({
                    id: t.id.toString(),
                    title: t.title,
                    duration_ms: t.duration * 1000
                }));
                success = true;
            } catch (e2: any) {
                console.log(`❌ 404 en ambas APIs.`);
            }
        }

        if (success && tracks.length > 0) {
            db.transaction(() => {
                for (const t of tracks) {
                    // INSERT SIN "title_clean" para evitar el error de SQLite
                    db.prepare(`
                        INSERT OR IGNORE INTO tracks (id, title, duration_ms, album_id, tidal_id)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(
                        randomUUID(),
                        t.title,
                        t.duration_ms,
                        album.local_id,
                        t.id
                    );

                    // Actualización masiva en play_history (aquí sí usamos los cleans que ya tienes ahí)
                    db.prepare(`
                        UPDATE play_history 
                        SET track_id = (SELECT id FROM tracks WHERE tidal_id = ?)
                        WHERE lower(track_name) = ?
                        AND album_name_clean = ?
                        AND artist_name_clean = ?
                    `).run(t.id, t.title.toLowerCase(), album.title_clean, album.name_clean);
                }
            })();
            console.log(`✅ (${tracks.length} tracks)`);
        }

        await sleep(1000); 
    }
    console.log("\n🏁 ¡Proceso terminado!");
}

harvest();