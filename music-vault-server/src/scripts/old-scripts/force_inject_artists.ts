import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

const ARTISTAS_A_RESCATAR = [
    "Billie Eilish", "SZA", "Joji", "Adele", "¥$", "Travis Scott", "KAROL G"
];

interface TidalArtistResource {
    id: string;
    type: string;
}

interface TidalAlbumItem {
    id: number | string;
    title: string;
}

async function forceInject() {
    console.log("🚀 INICIANDO INYECCIÓN DE EMERGENCIA PARA ARTISTAS TOP...");

    for (const name of ARTISTAS_A_RESCATAR) {
        try {
            console.log(`\n🔍 Buscando a ${name}...`);
            
            // 1. Buscar el artista
            const search = await tidal['api'].get<{ data: TidalArtistResource[] }>(
                `/v2/searchResults/${encodeURIComponent(name)}/relationships/artists`, 
                { params: { countryCode: "US", limit: 1 } }
            );

            const tidalArtist = search.data.data[0];
            if (!tidalArtist) {
                console.log(`❌ No se encontró a ${name} en Tidal.`);
                continue;
            }

            const tidalId = tidalArtist.id;
            const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "");

            // 2. Definir ID Local (Casteamos a string para evitar el error de tipo UUID)
            let localArtistId: string = randomUUID() as string;
            
            const existing = db.prepare("SELECT id FROM artists WHERE name_clean = ?").get(cleanName) as { id: string } | undefined;
            
            if (existing) {
                localArtistId = existing.id;
                db.prepare("UPDATE artists SET tidal_id = ? WHERE id = ?").run(tidalId, localArtistId);
                console.log(`   ♻️ Artista actualizado en DB.`);
            } else {
                db.prepare("INSERT INTO artists (id, name, tidal_id, name_clean) VALUES (?, ?, ?, ?)").run(
                    localArtistId, name, tidalId, cleanName
                );
                console.log(`   🆕 Artista creado en DB.`);
            }

            // 3. Traer discografía usando la v1 (más estable para listados masivos)
            console.log(`   📡 Bajando discografía de ${name} (Tidal ID: ${tidalId})...`);
            
            const albumsSearch = await tidal['api'].get<{ items: TidalAlbumItem[] }>(`/v1/artists/${tidalId}/albums`, {
                params: { countryCode: "US", limit: 50 }
            });
            
            const epsSearch = await tidal['api'].get<{ items: TidalAlbumItem[] }>(`/v1/artists/${tidalId}/albums`, {
                params: { countryCode: "US", filter: "EPSANDSINGLES", limit: 50 }
            });

            const allAlbums = [...(albumsSearch.data.items || []), ...(epsSearch.data.items || [])];

            const insertAlbum = db.prepare(`
                INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, title_clean)
                VALUES (?, ?, ?, ?, ?)
            `);

            db.transaction(() => {
                for (const alb of allAlbums) {
                    insertAlbum.run(
                        randomUUID() as string, 
                        alb.title, 
                        localArtistId, 
                        alb.id.toString(), 
                        alb.title.toLowerCase().replace(/[^a-z0-9]/g, "")
                    );
                }
            })();

            console.log(`   ✅ Cargados ${allAlbums.length} álbumes/singles.`);
            
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`   💥 Error con ${name}:`, msg);
        }
    }
    console.log("\n🏁 Proceso de inyección terminado.");
}

forceInject();