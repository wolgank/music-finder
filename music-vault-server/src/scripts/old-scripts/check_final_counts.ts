import db from "../../db";

const ARTISTAS = ["Adele", "¥$", "Billie Eilish", "Joji", "Karol G"];

console.log("\n📊 REPORTE DE SALUD DE DISCOGRAFÍAS");
console.log("--------------------------------------------------");

for (const name of ARTISTAS) {
    const artist = db.prepare("SELECT id, tidal_id FROM artists WHERE name LIKE ?").get(`%${name}%`) as any;
    
    if (!artist) {
        console.log(`❓ ${name.padEnd(15)} | No encontrado en DB.`);
        continue;
    }

    const albums = db.prepare("SELECT COUNT(*) as count FROM albums WHERE artist_id = ?").get(artist.id) as { count: number };
    const tracks = db.prepare(`
        SELECT COUNT(*) as count FROM tracks 
        WHERE album_id IN (SELECT id FROM albums WHERE artist_id = ?)
    `).get(artist.id) as { count: number };

    console.log(`👤 ${name.padEnd(15)} | ID: ${artist.tidal_id.padEnd(10)} | 💿 Álbumes: ${albums.count.toString().padEnd(3)} | 🎵 Tracks: ${tracks.count}`);
}
console.log("--------------------------------------------------\n");