// music-vault-server/src/scripts/harvest-albums.ts
import db from '../db';
import { TidalClient } from "../lib/tidal/client";
import * as fs from 'fs';
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cleanText(text: string): string {
    return (text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, "")
        .trim();
}

async function harvestAlbums() {
    console.log("🚀 COSECHA DE ÁLBUMES (PAGINACIÓN DINÁMICA)");

    const decisions = JSON.parse(fs.readFileSync('cleanup_decisions.json', 'utf-8'));
    const pendingArtists = decisions.manual_links.filter((m: any) => m.status === "registered");

    for (const artist of pendingArtists) {
        console.log(`\n👤 Artista: ${artist.artist_name} (ID: ${artist.correct_tidal_id})`);
        
        const dbArtist = db.prepare("SELECT id FROM artists WHERE tidal_id = ?").get(artist.correct_tidal_id) as { id: string };
        if (!dbArtist) continue;

        let nextCursor: string | null = null;
        let totalArtistAlbums = 0;
        let currentPage = 1;

        try {
            do {
                // Forzamos el limit a 20 ya que Tidal ignora valores superiores en este endpoint
                const params: any = { countryCode: "US", include: "albums", "page[limit]": 20 };
                if (nextCursor) params["page[cursor]"] = nextCursor;

                let response;
                try {
                    response = await tidal['api'].get(`/v2/artists/${artist.correct_tidal_id}/relationships/albums`, { params });
                } catch (err: any) {
                    if (err.response?.status === 429) {
                        console.log("\n🛑 Rate limit (429). Pausando 45s...");
                        await sleep(45000);
                        continue; 
                    }
                    throw err;
                }

                const included = response.data.included || [];
                // IMPORTANTE: Extraemos el cursor de meta.nextCursor
                nextCursor = response.data.links?.meta?.nextCursor || null;

                if (included.length === 0 && nextCursor) {
                    console.log("\n🚨 Anomalía: Página vacía pero con cursor activo. Abortando.");
                    console.log(JSON.stringify(response.data, null, 2));
                    return;
                }

                db.transaction(() => {
                    for (const alb of included) {
                        db.prepare(`
                            INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url, title_clean)
                            VALUES (?, ?, ?, ?, NULL, ?)
                        `).run(randomUUID(), alb.attributes.title, dbArtist.id, alb.id, cleanText(alb.attributes.title));
                        totalArtistAlbums++;
                    }
                })();

                process.stdout.write(`   📦 Pág ${currentPage}: +${included.length} (Total: ${totalArtistAlbums})${nextCursor ? ' ⏭️' : ' 🏁'}\r`);
                
                currentPage++;
                await sleep(1200); // Respiro constante para evitar el 429

            } while (nextCursor);

            // SEGURIDAD: Si un artista tiene exactamente 20 y no hubo más páginas, 
            // no es necesariamente un error, pero lo registramos para tu tranquilidad.
            if (totalArtistAlbums === 20 && currentPage === 2) {
                console.log(`\n   ℹ️  Nota: Se guardaron exactamente 20 álbumes (una sola página).`);
            } else {
                console.log(`\n   ✨ Finalizado: ${totalArtistAlbums} álbumes guardados en total.`);
            }

            artist.status = "albums_harvested";
            fs.writeFileSync('cleanup_decisions.json', JSON.stringify(decisions, null, 2));

        } catch (error: any) {
            console.error(`\n   🔴 Error con ${artist.artist_name}:`, error.message);
        }
    }
    console.log("\n🏁 Cosecha terminada.");
}

harvestAlbums();