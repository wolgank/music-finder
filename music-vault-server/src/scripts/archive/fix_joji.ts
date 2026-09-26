import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const JOJI_ID_CORRECTO = "5888982";

async function fixJoji() {
    console.log(`\n🦾 INICIANDO SCRAPEO TOTAL DE JOJI (ID: ${JOJI_ID_CORRECTO})`);

    const artist = db.prepare("SELECT id FROM artists WHERE tidal_id = ?").get(JOJI_ID_CORRECTO) as { id: string } | undefined;
    
    if (!artist) {
        console.log("❌ Error: No se encontró a Joji con el ID correcto en la DB. Revisa el Paso 1.");
        return;
    }

    // Usamos el endpoint de relaciones que permite paginación real
    let nextUrl: string | null = `https://openapi.tidal.com/v2/artists/${JOJI_ID_CORRECTO}/relationships/albums?countryCode=US&include=albums&page[limit]=50`;
    let count = 0;

    while (nextUrl) {
        try {
            const res = await tidal['api'].get(nextUrl, {
                headers: { 'accept': 'application/vnd.api+json' }
            });
            
            const data = res.data.data || [];
            const included = res.data.included || [];
            const links = res.data.links;

            if (data.length === 0) break;

            db.transaction(() => {
                for (const rel of data) {
                    const info = included.find((inc: any) => inc.id === rel.id && inc.type === "albums");
                    if (info) {
                        db.prepare(`
                            INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, title_clean)
                            VALUES (?, ?, ?, ?, ?)
                        `).run(
                            randomUUID(),
                            info.attributes.title,
                            artist.id,
                            rel.id,
                            info.attributes.title.toLowerCase().replace(/[^a-z0-9]/g, "")
                        );
                        count++;
                    }
                }
            })();

            // Avanzar a la siguiente página usando el link oficial
            nextUrl = links?.next ? `https://openapi.tidal.com/v2${links.next}` : null;
            if (nextUrl) console.log(`   + Página procesada. Álbumes acumulados: ${count}`);

        } catch (e: any) {
            console.error(`   ❌ Error en scrapeo: ${e.message}`);
            nextUrl = null;
        }
    }
    console.log(`\n✅ ¡Misión cumplida! Joji ahora tiene ${count} álbumes/singles en tu base de datos.`);
}

fixJoji();