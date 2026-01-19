import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

// Pon aquí los IDs que ya verificaste que son correctos
const IDS_A_PROCESAR = ["7514330"]; // Billie Eilish

async function harvestById() {
    console.log("⚡ INICIANDO EXTRACCIÓN POR ID DIRECTO...");

    for (const tId of IDS_A_PROCESAR) {
        try {
            // 1. Verificar si el artista existe en nuestra DB
            const artist = db.prepare("SELECT id, name FROM artists WHERE tidal_id = ?").get(tId) as { id: string, name: string } | undefined;

            if (!artist) {
                console.log(`❌ El ID ${tId} no existe en tu tabla 'artists'. Primero agrégalo o usa el inyector.`);
                continue;
            }

            console.log(`\n👤 Artista: ${artist.name} (ID: ${tId})`);

            // 2. Extraer Álbumes, EPs y Singles usando V2
            console.log(`   📡 Pidiendo discografía completa a Tidal...`);
            const res = await tidal['api'].get(`/v2/artists/${tId}/relationships/albums`, {
                params: { countryCode: "US", limit: 100, include: "items" }
            });

            const items = (res.data.included || []) as any[];
            console.log(`   📦 Encontrados ${items.length} ítems (álbumes/singles).`);

            db.transaction(() => {
                const insAlb = db.prepare(`
                    INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, title_clean) 
                    VALUES (?, ?, ?, ?, ?)
                `);

                for (const item of items) {
                    if (item.type === "albums") {
                        insAlb.run(
                            randomUUID() as string,
                            item.attributes.title,
                            artist.id,
                            item.id,
                            item.attributes.title.toLowerCase().replace(/[^a-z0-9]/g, "")
                        );
                    }
                }
            })();

            console.log(`   ✅ Álbumes inyectados para ${artist.name}.`);

        } catch (e: any) {
            console.error(`   ❌ Error con ID ${tId}: ${e.message}`);
        }
    }
    console.log("\n🏁 Proceso terminado. Ahora ya puedes correr harvest_all_tracks.ts");
}

harvestById();