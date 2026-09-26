import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function harvestSmart() {
    console.log("🎯 INICIANDO COSECHA DIRIGIDA A ÁLBUMES CRÍTICOS");

    // 1. Buscamos los nombres de artistas que tienen álbumes pendientes en el TOP 20 de fallos
    const targetArtists = db.prepare(`
        SELECT DISTINCT artist_name 
        FROM play_history 
        WHERE track_id IS NULL 
          AND album_name_clean NOT IN (SELECT title_clean FROM albums)
        GROUP BY artist_name, album_name
        ORDER BY COUNT(*) DESC
        LIMIT 25
    `).all() as { artist_name: string }[];

    const listaAProcesar = targetArtists.map(a => a.artist_name);
    console.log(`🔍 Artistas prioritarios identificados: ${listaAProcesar.join(", ")}`);

    for (const name of listaAProcesar) {
        console.log(`\n👤 Procesando Artista: ${name}`);
        
        // Buscamos su ID de Tidal en nuestra tabla de artistas
        const artist = db.prepare("SELECT id, tidal_id FROM artists WHERE name = ?").get(name) as { id: string, tidal_id: string } | undefined;
        
        if (!artist || !artist.tidal_id) {
            console.log(`   ⚠️ No tenemos el Tidal ID para ${name}. Primero debes buscarlo y agregarlo.`);
            continue;
        }

        let currentUrl: string | null = `https://openapi.tidal.com/v2/artists/${artist.tidal_id}/relationships/albums?countryCode=US&include=albums&page[limit]=50`;
        let totalArtistAlbums = 0;

        while (currentUrl) {
            try {
                const res = await tidal['api'].get(currentUrl, {
                    headers: { 'accept': 'application/vnd.api+json' }
                });
                
                const data = res.data.data || [];
                const included = res.data.included || [];
                const links = res.data.links;

                if (data.length === 0) break;

                db.transaction(() => {
                    for (const rel of data) {
                        const albumInfo = included.find((inc: any) => inc.id === rel.id && inc.type === "albums");
                        if (albumInfo) {
                            db.prepare(`
                                INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, title_clean)
                                VALUES (?, ?, ?, ?, ?)
                            `).run(
                                randomUUID(),
                                albumInfo.attributes.title,
                                artist.id,
                                rel.id,
                                albumInfo.attributes.title.toLowerCase().replace(/[^a-z0-9]/g, "")
                            );
                            totalArtistAlbums++;
                        }
                    }
                })();

                currentUrl = links?.next ? `https://openapi.tidal.com/v2${links.next}` : null;
                
                if (currentUrl) {
                    process.stdout.write(`   + ${totalArtistAlbums} álbumes acumulados...\r`);
                    await sleep(1000); 
                }

            } catch (e: any) {
                if (e.response?.status === 429) {
                    console.log("\n   🛑 BLOQUEO 429. Enfriando 30 seg...");
                    await sleep(30000);
                    continue;
                }
                console.error(`\n   ❌ Error: ${e.message}`);
                currentUrl = null;
            }
        }
        console.log(`\n   ✅ Finalizado para ${name}: ${totalArtistAlbums} álbumes en total.`);
        await sleep(2000);
    }

    console.log("\n🏁 Cosecha de objetivos terminada. Ahora corre 'harvest_all_tracks.ts' para llenar las canciones.");
}

harvestSmart();