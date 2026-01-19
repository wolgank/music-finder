import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

async function harvestBillie() {
    const BILLIE_ID = "7514330";
    console.log(`\n🌊 PROCESANDO DISCOGRAFÍA DE BILLIE EILISH (ID: ${BILLIE_ID})`);

    try {
        // 1. Verificar artista en DB local
        const artist = db.prepare("SELECT id FROM artists WHERE tidal_id = ?").get(BILLIE_ID) as { id: string };
        if (!artist) {
            console.log("❌ Billie no está en la tabla 'artists'. Ejecuta primero el inyector o agrégala.");
            return;
        }

        // 2. Pedir la info con el formato que me mostraste
        const res = await tidal['api'].get(`/v2/artists/${BILLIE_ID}`, {
            params: { countryCode: "US", include: "albums" }
        });

        const albumRelationships = res.data.data.relationships.albums.data; // Los IDs
        const includedDetails = res.data.included || []; // Los Atributos (títulos, etc)

        console.log(`📦 Tidal reportó ${albumRelationships.length} álbumes en la relación.`);

        let inserted = 0;
        db.transaction(() => {
            for (const rel of albumRelationships) {
                // Buscamos el detalle en el array 'included' usando el ID
                const details = includedDetails.find((inc: any) => inc.id === rel.id && inc.type === "albums");
                
                if (details) {
                    const title = details.attributes.title;
                    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");

                    const info = db.prepare(`
                        INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, title_clean)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(
                        randomUUID() as string,
                        title,
                        artist.id,
                        rel.id,
                        cleanTitle
                    );

                    if (info.changes > 0) {
                        console.log(`   ✅ Guardado: ${title}`);
                        inserted++;
                    }
                }
            }
        })();

        console.log(`\n✨ ¡Listo! Se agregaron ${inserted} álbumes nuevos de Billie Eilish.`);
        console.log("👉 Siguiente paso: Corre 'bun src/scripts/harvest_all_tracks.ts' para bajar las canciones.");

    } catch (error: any) {
        console.error("💥 Error:", error.response?.data || error.message);
    }
}

harvestBillie();