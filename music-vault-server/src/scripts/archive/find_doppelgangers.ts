import db from "../../db";

async function findDoppelgangers() {
    console.log("🕵️ Buscando artistas con múltiples personalidades (IDs duplicados)...");
    console.log("------------------------------------------------------------------");

    const duplicates = db.prepare(`
        SELECT name, name_clean, COUNT(*) as ocurrencias, GROUP_CONCAT(tidal_id) as ids
        FROM artists
        GROUP BY name_clean
        HAVING ocurrencias > 1
    `).all() as any[];

    if (duplicates.length === 0) {
        console.log("✅ No se encontraron nombres duplicados en la tabla 'artists'.");
        return;
    }

    for (const artist of duplicates) {
        console.log(`👤 Artista: ${artist.name.toUpperCase()}`);
        console.log(`   📝 Nombre limpio: ${artist.name_clean}`);
        console.log(`   🆔 IDs encontrados: ${artist.ids}`);
        
        const details = db.prepare(`
            SELECT tidal_id, (SELECT COUNT(*) FROM albums WHERE artist_id = artists.id) as total_albums
            FROM artists
            WHERE name_clean = ?
        `).all(artist.name_clean) as any[];

        details.forEach(d => {
            console.log(`      🔸 ID: ${d.tidal_id.padEnd(10)} | 📂 Álbumes en DB: ${d.total_albums}`);
        });
        console.log("");
    }
}

findDoppelgangers();