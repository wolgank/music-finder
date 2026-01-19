//detect-duplicates.ts
import db from '../db';

interface DuplicateEntry {
    name: string;
    occurrences: number;
    ids: string; // Lista de IDs concatenados
}

async function detectDuplicates() {
    console.log("🔍 Buscando duplicados en la base de datos maestra...");
    console.log("=".repeat(50));

    try {
        // 1. Detectar Artistas duplicados
        // Agrupamos por nombre normalizado (minúsculas) y contamos
        const duplicateArtists = db.prepare(`
            SELECT 
                name, 
                COUNT(*) as occurrences, 
                GROUP_CONCAT(id) as ids
            FROM artists
            GROUP BY LOWER(name)
            HAVING occurrences > 1
            ORDER BY occurrences DESC
        `).all() as DuplicateEntry[];

        // 2. Detectar Álbumes duplicados
        // Un álbum suele ser duplicado si tiene el mismo nombre y pertenece al mismo artista
        // pero aquí buscaremos duplicados globales por nombre como pediste
        const duplicateAlbums = db.prepare(`
            SELECT 
                title as name, 
                COUNT(*) as occurrences, 
                GROUP_CONCAT(id) as ids
            FROM albums
            GROUP BY LOWER(title)
            HAVING occurrences > 1
            ORDER BY occurrences DESC
        `).all() as DuplicateEntry[];

        // --- REPORTE DE ARTISTAS ---
        console.log(`\n👤 ARTISTAS REPETIDOS: ${duplicateArtists.length}`);
        if (duplicateArtists.length > 0) {
            console.table(duplicateArtists.slice(0, 15).map(a => ({
                Nombre: a.name,
                Repeticiones: a.occurrences,
                IDs: a.ids
            })));
            if (duplicateArtists.length > 15) console.log(`... y ${duplicateArtists.length - 15} artistas más.`);
        } else {
            console.log("✅ No se encontraron nombres de artistas duplicados.");
        }

        // --- REPORTE DE ÁLBUMES ---
        console.log(`\n💿 ÁLBUMES REPETIDOS: ${duplicateAlbums.length}`);
        if (duplicateAlbums.length > 0) {
            console.table(duplicateAlbums.slice(0, 15).map(al => ({
                Título: al.name,
                Repeticiones: al.occurrences,
                IDs: al.ids
            })));
            if (duplicateAlbums.length > 15) console.log(`... y ${duplicateAlbums.length - 15} álbumes más.`);
        } else {
            console.log("✅ No se encontraron nombres de álbumes duplicados.");
        }

        // --- RESUMEN FINAL ---
        const totalArtistImpact = duplicateArtists.reduce((acc, cur) => acc + (cur.occurrences - 1), 0);
        const totalAlbumImpact = duplicateAlbums.reduce((acc, cur) => acc + (cur.occurrences - 1), 0);

        console.log("\n" + "=".repeat(50));
        console.log("📊 RESUMEN DE IMPACTO:");
        console.log(`Total de registros de artistas sobrantes: ${totalArtistImpact}`);
        console.log(`Total de registros de álbumes sobrantes:  ${totalAlbumImpact}`);
        console.log("=".repeat(50));
        console.log("💡 Sugerencia: Estos IDs te servirán para el script de limpieza (Merge) que haremos pronto.");

    } catch (error) {
        console.error("\n🔴 Error al consultar duplicados:", (error as Error).message);
    }
}

detectDuplicates().catch(console.error);