//music-vault-server/src/scripts/manual_fix.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { createInterface } from "readline";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

// Interfaz para leer de la terminal
const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
  return new Promise(resolve => rl.question(query, resolve));
};

async function main() {
  console.log("👨‍⚕️ INICIANDO REPARACIÓN MANUAL DE ARTISTAS...");
  console.log("-----------------------------------------------");

  // 1. Buscar los "Huérfanos" (Artistas sin tidal_id)
  const missingArtists = db.prepare(`
    SELECT id, name FROM artists WHERE tidal_id IS NULL ORDER BY name ASC
  `).all() as { id: string, name: string }[];

  if (missingArtists.length === 0) {
      console.log("✅ ¡No hay artistas pendientes de reparación!");
      process.exit(0);
  }

  console.log(`🚑 Se encontraron ${missingArtists.length} artistas para revisar manualmente.\n`);

  // Statements SQL
  const updateArtist = db.prepare("UPDATE artists SET tidal_id = ? WHERE id = ?");
  const insertAlbum = db.prepare("INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url) VALUES (?, ?, ?, ?, ?)");
  const checkAlbum = db.prepare("SELECT id FROM albums WHERE title = ? AND artist_id = ?");

  for (const artist of missingArtists) {
    let currentSearchTerm = artist.name;
    let selectedId = null;
    let keepSearching = true;

    while (keepSearching) {
        console.log(`\n---------------------------------------------------`);
        console.log(`🔍 Buscando match para: \x1b[36m"${currentSearchTerm}"\x1b[0m (Original: "${artist.name}")`);
        
        try {
            const encodedName = encodeURIComponent(currentSearchTerm);
            const res = await tidal['api'].get(`/v2/searchResults/${encodedName}/relationships/artists`, {
                params: { countryCode: "PE", limit: 5 } // Traemos 5 opciones
            });

            const rawCandidates = res.data.data || [];
            
            // Si hay candidatos, traemos sus nombres reales para mostrartelos
            let candidates: any[] = [];
            if (rawCandidates.length > 0) {
                const ids = rawCandidates.map((c: any) => c.id).join(",");
                const detailRes = await tidal['api'].get(`/v2/artists`, {
                    params: { "filter[id]": ids, countryCode: "PE" }
                });
                candidates = detailRes.data.data;
            }

            if (candidates.length === 0) {
                console.log("⚠️  Tidal no encontró nada.");
            } else {
                console.log("Opciones encontradas:");
                candidates.forEach((c: any, index: number) => {
                    console.log(`   \x1b[33m[${index + 1}]\x1b[0m ${c.attributes.name} (ID: ${c.id})`);
                });
            }

            // --- INTERACCIÓN HUMANA ---
            console.log(`\nOpciones:`);
            console.log(`   [1-5] Seleccionar número`);
            console.log(`   [m]   Escribir búsqueda manual (Corregir nombre)`);
            console.log(`   [s]   Saltar este artista`);
            
            const answer = await askQuestion("👉 Tu elección: ");
            const choice = answer.trim().toLowerCase();

            if (choice === 's') {
                keepSearching = false; // Next artist
            } else if (choice === 'm') {
                const manualName = await askQuestion("⌨️  Escribe el nombre correcto para buscar: ");
                if (manualName) currentSearchTerm = manualName;
            } else {
                const index = parseInt(choice) - 1;
                if (!isNaN(index) && candidates[index]) {
                    // ¡SELECCIONADO!
                    const selected = candidates[index];
                    console.log(`✅ Seleccionaste: ${selected.attributes.name}`);
                    
                    // 1. Actualizar DB
                    updateArtist.run(selected.id, artist.id);
                    selectedId = selected.id;
                    keepSearching = false;

                    // 2. Bajar Álbumes Inmediatamente
                    console.log("📚 Bajando discografía...");
                    try {
                        const albumRes = await tidal['api'].get(`/v2/artists/${selectedId}`, {
                            params: { countryCode: "PE", include: "albums" }
                        });
                        const included = albumRes.data.included || [];
                        const tidalAlbums = included.filter((x: any) => x.type === "albums");

                        const tx = db.transaction(() => {
                            for (const alb of tidalAlbums) {
                                const attr = alb.attributes;
                                let coverUrl = null;
                                if (attr.cover) {
                                    const path = attr.cover.replace(/-/g, '/');
                                    coverUrl = `https://resources.tidal.com/images/${path}/640x640.jpg`;
                                }
                                if (!checkAlbum.get(attr.title, artist.id)) {
                                    insertAlbum.run(randomUUID(), attr.title, artist.id, alb.id, coverUrl);
                                }
                            }
                        });
                        tx();
                        console.log(`💾 Guardados ${tidalAlbums.length} álbumes.`);
                    } catch (err) {
                        console.error("❌ Error bajando álbumes (se puede reintentar luego).");
                    }

                } else {
                    console.log("❌ Opción inválida.");
                }
            }

        } catch (error: any) {
            console.error("❌ Error de red o API:", error.message);
            if (error.response?.status === 429) {
                console.log("⏳ Rate Limit. Esperando 5s...");
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
  }

  console.log("\n🏁 ¡REPARACIÓN MANUAL COMPLETADA!");
  rl.close();
}

main();