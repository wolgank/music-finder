//music-vault-server/src/scripts/manual_fix_orphans.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";
import * as readline from "node:readline/promises";

interface TidalAlbumResource {
    id: string;
    type: string;
    attributes: {
        title: string;
        cover: string | null;
        type: string;
        releaseDate: string;
    };
}

interface TidalRelationshipResponse {
    data: { id: string; type: string }[];
    included?: TidalAlbumResource[];
    links?: {
        meta?: {
            nextCursor: string;
        };
    };
}

interface SimplifiedAlbum {
    id: string;
    title: string;
    cover: string | null;
    type: string;
    releaseDate: string;
}

interface OrphanArtist {
    artist_name: string;
    album_name: string;
}

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function cleanString(str: string): string {
    if (!str) return "";
    return str.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

async function getDiscography(tidalId: string): Promise<SimplifiedAlbum[]> {
    const fullDiscography: SimplifiedAlbum[] = [];
    let nextCursor: string | undefined = undefined;
    let hasMore = true;

    try {
        while (hasMore) {
            const params: Record<string, string | number> = { 
                countryCode: "US", 
                limit: 100,
                include: "albums" // Esto mete los detalles en el campo 'included'
            };
            if (nextCursor) params["page[cursor]"] = nextCursor;

            const res = await tidal['api'].get<TidalRelationshipResponse>(`/v2/artists/${tidalId}/relationships/albums`, { params });
            
            // Extraemos la información del bloque 'included' que es donde vienen los títulos
            const included = res.data.included || [];
            
            included.forEach(item => {
                if (item.type === "albums") {
                    fullDiscography.push({
                        id: item.id,
                        title: item.attributes.title,
                        cover: item.attributes.cover,
                        type: item.attributes.type,
                        releaseDate: item.attributes.releaseDate
                    });
                }
            });

            nextCursor = res.data.links?.meta?.nextCursor;
            if (!nextCursor) hasMore = false;
        }
        return fullDiscography;
    } catch (e) {
        return [];
    }
}

async function main() {
    console.log("🛠️  REPARACIÓN MANUAL (FIXED: SOPORTE PARA 'INCLUDED')");

    const orphans = db.prepare(`
        SELECT DISTINCT artist_name, album_name FROM play_history 
        WHERE artist_name NOT IN (SELECT name FROM artists)
        AND album_name NOT IN (SELECT title FROM albums)
    `).all() as OrphanArtist[];

    console.log(`📊 Huérfanos a procesar: ${orphans.length}`);
    
    for (const orphan of orphans) {
        console.log(`\n===================================================`);
        console.log(`👤 ARTISTA: \x1b[36m${orphan.artist_name}\x1b[0m`);
        console.log(`💿 BUSCANDO COINCIDENCIA CON: ${orphan.album_name}`);
        
        const tidalId = await rl.question(`🆔 Ingresa ID de Tidal (o 's' para saltar): `);
        if (tidalId.toLowerCase() === 's') continue;

        console.log(`   ⏳ Recuperando discografía...`);
        const tidalAlbums = await getDiscography(tidalId);
        
        if (tidalAlbums.length === 0) {
            console.log(`   ❌ No se pudieron extraer álbumes para el ID ${tidalId}. Verifica el ID.`);
            continue;
        }

        console.log(`\n📋 DISCOGRAFÍA ENCONTRADA EN TIDAL (${tidalAlbums.length} ítems):`);
        const sortedAlbums = [...tidalAlbums].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
        
        sortedAlbums.forEach(alb => {
            console.log(`   [${alb.type.padEnd(7)}] ${alb.releaseDate} - ${alb.title}`);
        });

        const cleanHistoryAlbum = cleanString(orphan.album_name);
        const isMatch = tidalAlbums.some(a => 
            cleanString(a.title).includes(cleanHistoryAlbum) || 
            cleanHistoryAlbum.includes(cleanString(a.title))
        );

        if (isMatch) {
            console.log(`\n   ✅ MATCH AUTOMÁTICO CONFIRMADO.`);
        } else {
            console.log(`\n   ⚠️ ADVERTENCIA: No se encontró "${orphan.album_name}" en la lista.`);
        }

        const confirm = await rl.question(`💾 ¿Guardar artista y sus ${tidalAlbums.length} álbumes? (y/n): `);
        
        if (confirm.toLowerCase() === 'y') {
            const artistUuid = randomUUID();
            db.transaction(() => {
                db.prepare(`INSERT OR IGNORE INTO artists (id, name, tidal_id) VALUES (?, ?, ?)`).run(artistUuid, orphan.artist_name, tidalId);
                const insAlb = db.prepare(`INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url) VALUES (?, ?, ?, ?, ?)`);
                for (const alb of tidalAlbums) {
                    const coverUrl = alb.cover ? `https://resources.tidal.com/images/${alb.cover.replace(/-/g, '/')}/640x640.jpg` : null;
                    insAlb.run(randomUUID(), alb.title, artistUuid, alb.id, coverUrl);
                }
            })();
            console.log(`   💾 ¡Guardado con éxito!`);
        }
    }
    rl.close();
}

main().catch(console.error);