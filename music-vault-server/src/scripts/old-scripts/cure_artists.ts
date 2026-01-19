//music-vault-server/src/scripts/fill_missing_albums.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";
import * as readline from "node:readline/promises";

// Interfaces estrictas para la API de Tidal
interface TidalAlbumAttributes {
    title: string;
    releaseDate: string;
    type: string;
    cover: string | null;
}

interface TidalAlbumResource {
    id: string;
    type: string;
    attributes: TidalAlbumAttributes;
}

interface TidalResponse {
    data: { id: string; type: string }[];
    included?: TidalAlbumResource[];
    links?: {
        meta?: {
            nextCursor: string;
        };
    };
}

interface OrphanArtist {
    artist_name: string;
    album_name: string;
}

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function getFullDiscography(tidalId: string): Promise<TidalAlbumResource[]> {
    const fullList: TidalAlbumResource[] = [];
    let nextCursor: string | undefined = undefined;
    let hasMore = true;

    try {
        while (hasMore) {
            const params: Record<string, string | number> = { 
                countryCode: "US", 
                limit: 100,
                include: "albums" 
            };
            if (nextCursor) params["page[cursor]"] = nextCursor;

            const res = await tidal['api'].get<TidalResponse>(`/v2/artists/${tidalId}/relationships/albums`, { params });
            
            // Extraemos los álbumes del bloque 'included'
            const included = res.data.included || [];
            included.forEach(item => {
                if (item.type === "albums") {
                    fullList.push(item);
                }
            });

            nextCursor = res.data.links?.meta?.nextCursor;
            if (!nextCursor) hasMore = false;
        }
    } catch (e) {
        console.error("   ❌ Error accediendo a la API de Tidal para este ID.");
    }
    return fullList;
}

async function main() {
    console.log("🛠️  ASISTENTE DE REPARACIÓN DE HUÉRFANOS");
    console.log("---------------------------------------");

    // Obtenemos los 74 huérfanos reales (ajustado a tu consulta de auditoría)
    const orphans = db.prepare(`
        SELECT DISTINCT artist_name, album_name FROM play_history 
        WHERE artist_name NOT IN (SELECT name FROM artists)
        AND album_name NOT IN (SELECT title FROM albums)
    `).all() as OrphanArtist[];

    console.log(`📊 Artistas pendientes: ${orphans.length}`);

    for (const orphan of orphans) {
        console.log(`\n👤 ARTISTA: \x1b[36m${orphan.artist_name}\x1b[0m`);
        console.log(`💿 BUSCANDO: ${orphan.album_name}`);
        
        const inputId = await rl.question(`🆔 Ingresa el ID de Tidal (o 's' para saltar): `);
        
        if (inputId.toLowerCase() === 's') continue;

        console.log(`   ⏳ Extrayendo discografía completa para ID: ${inputId}...`);
        const albums = await getFullDiscography(inputId);

        if (albums.length === 0) {
            console.log("   ⚠️ No se encontraron álbumes. Revisa el ID.");
            continue;
        }

        console.log(`   ✅ Encontrados ${albums.length} lanzamientos.`);
        
        // Listar álbumes para confirmación visual
        console.log("\n   --- DISCOGRAFÍA ---");
        albums.sort((a, b) => b.attributes.releaseDate.localeCompare(a.attributes.releaseDate))
              .slice(0, 15) // Mostramos los últimos 15 para no saturar
              .forEach(a => console.log(`   [${a.attributes.type.padEnd(7)}] ${a.attributes.releaseDate} - ${a.attributes.title}`));
        if (albums.length > 15) console.log(`   ... y ${albums.length - 15} más.`);

        const confirm = await rl.question(`\n💾 ¿Guardar en la base de datos? (y/n): `);

        if (confirm.toLowerCase() === 'y') {
            const artistUuid = randomUUID();
            
            db.transaction(() => {
                // 1. Insertar Artista
                db.prepare(`INSERT OR IGNORE INTO artists (id, name, tidal_id) VALUES (?, ?, ?)`).run(
                    artistUuid, 
                    orphan.artist_name, 
                    inputId
                );

                // 2. Insertar Álbumes
                const insertAlbum = db.prepare(`
                    INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url) 
                    VALUES (?, ?, ?, ?, ?)
                `);

                for (const alb of albums) {
                    let coverUrl = null;
                    if (alb.attributes.cover) {
                        const path = alb.attributes.cover.replace(/-/g, '/');
                        coverUrl = `https://resources.tidal.com/images/${path}/640x640.jpg`;
                    }
                    insertAlbum.run(randomUUID(), alb.attributes.title, artistUuid, alb.id, coverUrl);
                }
            })();
            console.log("   ✨ ¡Datos guardados correctamente!");
        }
    }

    console.log("\n🏁 Proceso terminado.");
    rl.close();
}

main().catch(console.error);