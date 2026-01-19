import db from "../../db";

// Función de limpieza extrema para encontrar coincidencias "difusas"
function superClean(str: string): string {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
        .replace(/\(.*\)|\[.*\]/g, "")   // Quitar (Deluxe), [Remaster], etc.
        .replace(/deluxe|remaster|edition|version|feat\.|live|20\d{2}/g, "")
        .replace(/[^a-z0-9]/g, "")       // Solo letras y números
        .trim();
}

async function diagnose() {
    console.log("🔍 INVESTIGANDO LOS 2,781 CASOS 'SIN ÁLBUM'...");
    console.log("-----------------------------------------------");

    // 1. Obtener los álbumes únicos que el historial dice que "no existen"
    const missingInTheory = db.prepare(`
        SELECT DISTINCT ph.album_name, ph.artist_name, ph.album_name_clean, ph.artist_name_clean
        FROM play_history ph
        WHERE ph.track_id IS NULL 
        AND EXISTS (SELECT 1 FROM artists a WHERE a.name_clean = ph.artist_name_clean)
        AND NOT EXISTS (SELECT 1 FROM albums alb WHERE alb.title_clean = ph.album_name_clean)
    `).all() as { album_name: string, artist_name: string, album_name_clean: string, artist_name_clean: string }[];

    console.log(`📊 Analizando ${missingInTheory.length} álbumes únicos del historial que no tienen match exacto...`);

    let likelyFound = 0;
    const samples: string[] = [];

    for (const m of missingInTheory) {
        const cleanHAlbum = superClean(m.album_name);

        // Buscar en los álbumes que ya tenemos para ese artista específico
        const possibleMatches = db.prepare(`
            SELECT title FROM albums 
            WHERE artist_id = (SELECT id FROM artists WHERE name_clean = ?)
        `).all(m.artist_name_clean) as { title: string }[];

        const match = possibleMatches.find(p => {
            const cleanDBAlbum = superClean(p.title);
            // Coincidencia si uno contiene al otro tras la limpieza extrema
            return cleanDBAlbum.includes(cleanHAlbum) || cleanHAlbum.includes(cleanDBAlbum);
        });

        if (match) {
            likelyFound++;
            if (samples.length < 15) {
                samples.push(`   📍 Historial: "${m.album_name}"\n      En DB:     "${match.title}" (Artista: ${m.artist_name})`);
            }
        }
    }

    console.log("\n-----------------------------------------------");
    console.log(`✅ RESULTADO DEL DIAGNÓSTICO:`);
    console.log(`   Se encontraron ${likelyFound} álbumes que SÍ ESTÁN en tu DB pero con nombre diferente.`);
    console.log(`   Quedan ${missingInTheory.length - likelyFound} álbumes que REALMENTE no están en tu DB.`);
    console.log("-----------------------------------------------\n");

    if (samples.length > 0) {
        console.log("👀 EJEMPLOS DE DESCOORDINACIÓN DE NOMBRES:");
        samples.forEach(s => console.log(s + "\n"));
    }

    if (likelyFound > 0) {
        console.log("👉 CONCLUSIÓN: Podemos recuperar esos álbumes vinculándolos con un script de 'Fuzzy Match'.");
    } else {
        console.log("👉 CONCLUSIÓN: Los álbumes realmente no se descargaron. Necesitamos pedirlos a Tidal.");
    }
}

diagnose();