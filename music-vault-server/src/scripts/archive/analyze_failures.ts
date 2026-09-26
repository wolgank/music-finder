import db from "../../db";

async function analyze() {
    console.log("🕵️ ANALIZANDO HUECOS EN LA BIBLIOTECA...");
    console.log("---------------------------------------");

    // 1. Artistas que no están en la tabla 'artists'
    const unknownArtists = db.prepare(`
        SELECT COUNT(DISTINCT ph.artist_name_clean) as count
        FROM play_history ph
        WHERE NOT EXISTS (SELECT 1 FROM artists a WHERE a.name_clean = ph.artist_name_clean)
    `).get() as { count: number };

    // 2. Artistas que SI están, pero el ÁLBUM no existe en 'albums'
    const missingAlbums = db.prepare(`
        SELECT COUNT(DISTINCT ph.album_name_clean || ph.artist_name_clean) as count
        FROM play_history ph
        WHERE EXISTS (SELECT 1 FROM artists a WHERE a.name_clean = ph.artist_name_clean)
        AND NOT EXISTS (SELECT 1 FROM albums alb WHERE alb.title_clean = ph.album_name_clean)
        AND ph.track_id IS NULL
    `).get() as { count: number };

    // 3. Artistas que tienen el álbum, pero el álbum tiene 0 tracks en nuestra tabla 'tracks'
    const albumsWithNoTracks = db.prepare(`
        SELECT COUNT(DISTINCT alb.id) as count
        FROM albums alb
        WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = alb.id)
    `).get() as { count: number };

    console.log(`👤 Artistas no registrados en DB:      ${unknownArtists.count}`);
    console.log(`💿 Álbumes faltantes (artista existe): ${missingAlbums.count}`);
    console.log(`⚠️  Álbumes en DB pero con 0 tracks:    ${albumsWithNoTracks.count}`);
    console.log("---------------------------------------");

    // Muestra de los 48 fallos de nombre
    console.log("\n🔍 ANÁLISIS DE LOS 48 FALLOS DE NOMBRE (Matching fallido):");
    const nameFailures = db.prepare(`
        SELECT DISTINCT ph.track_name, alb.title as tidal_album, ph.artist_name
        FROM play_history ph
        JOIN albums alb ON ph.album_name_clean = alb.title_clean
        JOIN artists art ON alb.artist_id = art.id AND ph.artist_name_clean = art.name_clean
        WHERE ph.track_id IS NULL
        LIMIT 10
    `).all() as any[];

    nameFailures.forEach(f => {
        console.log(`   - [${f.artist_name}] "${f.track_name}"`);
        console.log(`     Se buscó en álbum: "${f.tidal_album}"`);
    });

    // Muestra de artistas desconocidos para ver si son erratas
    console.log("\n📋 MUESTRA DE ARTISTAS NO REGISTRADOS:");
    const artistSamples = db.prepare(`
        SELECT DISTINCT artist_name FROM play_history ph
        WHERE NOT EXISTS (SELECT 1 FROM artists a WHERE a.name_clean = ph.artist_name_clean)
        LIMIT 5
    `).all() as any[];
    artistSamples.forEach(a => console.log(`   - ${a.artist_name}`));
}

analyze();