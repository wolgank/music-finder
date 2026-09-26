import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

async function smartPurge() {
    console.log("🧠 INICIANDO PURGA INTELIGENTE (VERIFICACIÓN DE IDENTIDAD)");
    console.log("--------------------------------------------------");

    const groups = db.prepare(`
        SELECT name, name_clean, COUNT(*) as count 
        FROM artists 
        GROUP BY name_clean 
        HAVING count > 1
    `).all() as { name: string, name_clean: string }[];

    console.log(`🔍 Se encontraron ${groups.length} grupos de duplicados.\n`);

    for (const group of groups) {
        try {
            process.stdout.write(`👤 Verificando: ${group.name.toUpperCase()}... `);

            // 1. Preguntar a Tidal el ID oficial
            const search = await tidal['api'].get(`/v2/searchResults/${encodeURIComponent(group.name)}/relationships/artists`, {
                params: { countryCode: "US", limit: 1 }
            });

            const officialTidalId = search.data.data[0]?.id;

            if (!officialTidalId) {
                console.log("⚠️  No verificado en Tidal.");
                continue;
            }

            // 2. Identificar registros locales
            const members = db.prepare(`SELECT id, tidal_id FROM artists WHERE name_clean = ?`).all(group.name_clean) as any[];
            
            const winner = members.find(m => m.tidal_id === officialTidalId);
            const losers = members.filter(m => m.tidal_id !== officialTidalId);

            if (!winner) {
                console.log(`❌ ID oficial (${officialTidalId}) no está en DB local. Manteniendo duplicados por seguridad.`);
                continue;
            }

            // 3. Ejecutar fusión y limpieza
            db.transaction(() => {
                for (const loser of losers) {
                    // Mover álbumes del impostor al oficial
                    db.prepare(`UPDATE albums SET artist_id = ? WHERE artist_id = ?`).run(winner.id, loser.id);
                    // Borrar al impostor
                    db.prepare(`DELETE FROM artists WHERE id = ?`).run(loser.id);
                }
            })();
            
            console.log(`✅ Ganador: ${winner.tidal_id} | 🗑️  Eliminados: ${losers.length}`);

        } catch (e: any) {
            console.log(`💥 Error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 400)); // Evitar Rate Limit
    }

    console.log("\n🏁 Purga inteligente finalizada.");
}

smartPurge();