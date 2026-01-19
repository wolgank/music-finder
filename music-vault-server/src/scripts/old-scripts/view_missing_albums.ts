import db from "../../db";

async function viewMissing(page: number = 1) {
    const limit = 50;
    const offset = (page - 1) * limit;

    console.log(`\n🧐 REVISANDO ÁLBUMES FALTANTES (Página ${page})`);
    console.log("--------------------------------------------------");

    // Consulta para obtener álbumes únicos que no están en la tabla 'albums'
    const totalCount = db.prepare(`
        SELECT COUNT(DISTINCT ph.album_name_clean || ph.artist_name_clean) as count
        FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND NOT EXISTS (SELECT 1 FROM albums alb WHERE alb.title_clean = ph.album_name_clean)
        AND EXISTS (SELECT 1 FROM artists art WHERE art.name_clean = ph.artist_name_clean)
    `).get() as { count: number };

    const missing = db.prepare(`
        SELECT DISTINCT ph.album_name, ph.artist_name
        FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND NOT EXISTS (SELECT 1 FROM albums alb WHERE alb.title_clean = ph.album_name_clean)
        AND EXISTS (SELECT 1 FROM artists art WHERE art.name_clean = ph.artist_name_clean)
        ORDER BY ph.artist_name ASC, ph.album_name ASC
        LIMIT ? OFFSET ?
    `).all(limit, offset) as { album_name: string, artist_name: string }[];

    if (missing.length === 0) {
        console.log("✨ No hay más álbumes en esta página.");
        return;
    }

    missing.forEach((item, index) => {
        const globalIndex = offset + index + 1;
        console.log(`${globalIndex.toString().padEnd(4)} | 👤 \x1b[36m${item.artist_name.padEnd(25)}\x1b[0m | 💿 ${item.album_name}`);
    });

    const totalPages = Math.ceil(totalCount.count / limit);
    console.log("--------------------------------------------------");
    console.log(`📄 Página ${page} de ${totalPages} | Mostrando ${missing.length} de ${totalCount.count} álbumes.`);
    console.log(`\n💡 Para ver la siguiente página usa: \x1b[33mbun src/scripts/view_missing_albums.ts ${page + 1}\x1b[0m\n`);
}

// Leer la página desde los argumentos de la terminal
const pageArg = parseInt(process.argv[2] || "1");
viewMissing(pageArg);