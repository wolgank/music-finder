//music-vault-server/src/scripts/quick_audit.ts
import db from "../../db";
import "dotenv/config";

// Normalización estricta para comparar
function cleanString(str: string) {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Quitar acentos/tildes
        .replace(/[^a-z0-9]/g, "")       // Solo alfanuméricos
        .trim();
}

async function reconcile() {
    console.log("🔍 INICIANDO CONCILIACIÓN DE HISTORIAL VS BASE DE DATOS...");
    console.log("----------------------------------------------------------");

    // 1. Obtener todos los artistas únicos del historial
    const historyEntries = db.prepare(`
        SELECT DISTINCT artist_name, album_name 
        FROM play_history 
        WHERE artist_name IS NOT NULL AND album_name IS NOT NULL
    `).all() as { artist_name: string, album_name: string }[];

    // 2. Cargar en memoria los artistas y álbumes que ya tenemos para búsqueda rápida
    const dbArtists = db.prepare(`SELECT id, name, tidal_id FROM artists`).all() as any[];
    const dbAlbums = db.prepare(`SELECT title, artist_id FROM albums`).all() as any[];

    let totalHistory = historyEntries.length;
    let foundByArtist = 0;
    let foundByAlbumMatch = 0;
    let realOrphans = [];

    console.log(`📊 Analizando ${totalHistory} entradas de historial...`);

    for (const entry of historyEntries) {
        const cleanHArtist = cleanString(entry.artist_name);
        const cleanHAlbum = cleanString(entry.album_name);

        // INTENTO 1: ¿Existe el artista por nombre (normalizado)?
        const artistMatch = dbArtists.find(a => cleanString(a.name) === cleanHArtist);

        if (artistMatch) {
            foundByArtist++;
            continue; 
        }

        // INTENTO 2: ¿Existe el álbum en la tabla 'albums'? 
        // Si el álbum existe, el artista ya está en la tabla 'artists' aunque se escriba diferente.
        const albumMatch = dbAlbums.find(alb => cleanString(alb.title) === cleanHAlbum);

        if (albumMatch) {
            // Buscamos el nombre que tenemos en la DB para ese artista
            const linkedArtist = dbArtists.find(a => a.id === albumMatch.artist_id);
            foundByAlbumMatch++;
            // Opcional: console.log(`💡 Match por álbum: "${entry.artist_name}" es probablemente "${linkedArtist?.name}"`);
            continue;
        }

        // Si llegó aquí, no lo encontramos ni por artista ni por álbum
        realOrphans.push(entry);
    }

    // 3. Reporte Final
    console.log("\n----------------------------------------------------------");
    console.log("🏁 RESUMEN DE CONCILIACIÓN:");
    console.log(`✅ Ya están en DB (por nombre):     ${foundByArtist}`);
    console.log(`🧩 Vinculados (por match de álbum): ${foundByAlbumMatch}`);
    console.log(`🚨 Huérfanos Reales (No en DB):     ${realOrphans.length}`);
    console.log("----------------------------------------------------------");

    if (realOrphans.length > 0) {
        console.log("\n📋 MUESTRA DE HUÉRFANOS (Artistas + Álbumes totalmente nuevos):");
        // Agrupar por artista para no repetir
        const uniqueOrphans = Array.from(new Set(realOrphans.map(o => o.artist_name))).slice(0, 20);
        uniqueOrphans.forEach(name => {
            const example = realOrphans.find(o => o.artist_name === name);
            console.log(`   - ${name} (Ej. Álbum: ${example?.album_name})`);
        });
        
        if (realOrphans.length > 20) console.log(`   ... y ${realOrphans.length - 20} más.`);
        
        console.log("\n👉 RECOMENDACIÓN: Estos son los que deberías buscar con el script de cosecha.");
    }
}

reconcile();