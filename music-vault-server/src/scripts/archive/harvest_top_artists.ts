import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

const ARTISTAS_TOP = [
    "Billie Eilish", "SZA", "Joji", "Adele", "¥$", "Travis Scott", "KAROL G"
];

async function harvestTop() {
    console.log("🔥 INICIANDO COSECHA DE ARTISTAS TOP (LÓGICA DE RELACIONES)");

    for (const name of ARTISTAS_TOP) {
        try {
            console.log(`\n🔍 Procesando: ${name}`);
            
            // 1. Buscar el ID de Tidal del artista
            const search = await tidal['api'].get(`/v2/searchResults/${encodeURIComponent(name)}/relationships/artists`, {
                params: { countryCode: "US", limit: 1 }
            });

            const tArtist = search.data.data[0];
            if (!tArtist) {
                console.log(`   ⚠️ No se encontró a ${name} en Tidal.`);
                continue;
            }

            const tId = tArtist.id;
            const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "");

            // 2. Asegurar que el artista existe en nuestra DB (ON CONFLICT para evitar errores de UNIQUE)
            db.prepare(`
                INSERT INTO artists (id, name, tidal_id, name_clean) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(tidal_id) DO UPDATE SET name=excluded.name
            `).run(randomUUID(), name, tId, cleanName);

            const localArtist = db.prepare("SELECT id FROM artists WHERE tidal_id = ?").get(tId) as { id: string };

            // 3. Pedir el objeto artista incluyendo sus álbumes (Protocolo V2)
            const res = await tidal['api'].get(`/v2/artists/${tId}`, {
                params: { countryCode: "US", include: "albums" }
            });

            const albumRelations = res.data.data.relationships.albums.data || [];
            const includedDetails = res.data.included || [];

            console.log(`   📦 Relacionados: ${albumRelations.length} álbumes/singles.`);

            let insertedCount = 0;
            db.transaction(() => {
                const insAlb = db.prepare(`
                    INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, title_clean) 
                    VALUES (?, ?, ?, ?, ?)
                `);

                for (const rel of albumRelations) {
                    const details = includedDetails.find((inc: any) => inc.id === rel.id && inc.type === "albums");
                    if (details) {
                        const title = details.attributes.title;
                        const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
                        
                        const info = insAlb.run(
                            randomUUID(),
                            title,
                            localArtist.id,
                            rel.id,
                            cleanTitle
                        );
                        if (info.changes > 0) insertedCount++;
                    }
                }
            })();

            console.log(`   ✅ Éxito: ${insertedCount} nuevos registros para ${name}.`);

        } catch (e: any) {
            console.error(`   ❌ Error con ${name}:`, e.response?.data || e.message);
        }
    }
    console.log("\n🏁 Cosecha de artistas Top finalizada.");
}

harvestTop();