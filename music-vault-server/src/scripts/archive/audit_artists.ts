//music-vault-server/src/scripts/audit_artists.ts
import db from "../../db";
import "dotenv/config";

// Función para limpiar strings y comparar (ignora mayúsculas, signos, etc.)
function cleanString(str: string) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/\(.*\)/g, "") // Quitar texto entre paréntesis
        .replace(/deluxe|remaster|edition|version|feat\.|live/g, "")
        .replace(/[^a-z0-9]/g, "") // Solo letras y números
        .trim();
}

async function audit() {
  console.log("🕵️‍♂️ INICIANDO AUDITORÍA DE ARTISTAS...");
  console.log("---------------------------------------");

  // 1. Obtener todos los artistas que ya "validamos" (tienen tidal_id)
  const artists = db.prepare(`
    SELECT id, name, tidal_id 
    FROM artists 
    WHERE tidal_id IS NOT NULL
  `).all() as { id: string, name: string, tidal_id: string }[];

  console.log(`📊 Revisando ${artists.length} artistas guardados en la base de datos...`);

  let suspiciousCount = 0;
  let verifiedCount = 0;
  let noDataCount = 0;

  console.log("\n⚠️  LISTA DE ARTISTAS SOSPECHOSOS (Posible ID Incorrecto):");
  console.log("---------------------------------------------------------");

  for (const artist of artists) {
    // 2. Obtener los álbumes que TÚ has escuchado de este artista (Historial)
    const historyAlbums = db.prepare(`
        SELECT DISTINCT album_name 
        FROM play_history 
        WHERE artist_name = ? AND album_name IS NOT NULL AND album_name != ''
    `).all(artist.name) as { album_name: string }[];

    if (historyAlbums.length === 0) {
        noDataCount++;
        continue; // No podemos verificar si no has escuchado álbumes (solo singles sin album data?)
    }

    // 3. Obtener los álbumes que HEMOS DESCARGADO para este ID (Tabla albums)
    const harvestedAlbums = db.prepare(`
        SELECT title 
        FROM albums 
        WHERE artist_id = ?
    `).all(artist.id) as { title: string }[];

    if (harvestedAlbums.length === 0) {
        // Si tiene ID pero no bajamos álbumes, es raro, pero puede pasar si falló la red
        continue; 
    }

    // 4. COMPARACIÓN CRUZADA (Cross-Check)
    // Buscamos si AL MENOS UN álbum del historial coincide con los descargados
    let matchFound = false;

    // Pre-limpiamos para optimizar
    const cleanHarvested = harvestedAlbums.map(a => cleanString(a.title));

    for (const hAlbum of historyAlbums) {
        const cleanHistory = cleanString(hAlbum.album_name);
        
        // Verificamos si este álbum del historial existe en la lista descargada
        // Usamos includes bidireccional para flexibilidad
        const exists = cleanHarvested.some(tVal => tVal.includes(cleanHistory) || cleanHistory.includes(tVal));
        
        if (exists) {
            matchFound = true;
            break; // Con una coincidencia nos basta para confiar en el Artista
        }
    }

    // 5. REPORTE
    if (!matchFound) {
        suspiciousCount++;
        console.log(`\n🔴 \x1b[31m${artist.name}\x1b[0m (ID Actual: ${artist.tidal_id})`);
        console.log(`   💿 Tú escuchaste:     "${historyAlbums[0].album_name}"`);
        console.log(`   ❌ En la DB (Tidal):  "${harvestedAlbums[0]?.title || 'Sin álbumes'}"`);
        
        // Lógica extra: Si escuchaste muchos álbumes y ninguno coincide, es muy grave
        if (historyAlbums.length > 1) {
             console.log(`   ⚠️  Mismatch total en ${historyAlbums.length} álbumes del historial.`);
        }
    } else {
        verifiedCount++;
    }
  }

  console.log("\n---------------------------------------");
  console.log("🏁 RESUMEN DE LA AUDITORÍA:");
  console.log(`✅ Artistas Verificados (Correctos): ${verifiedCount}`);
  console.log(`🔴 Artistas Sospechosos (Incorrectos): ${suspiciousCount}`);
  console.log(`⚪ Sin datos suficientes: ${noDataCount}`);
  
  if (suspiciousCount > 0) {
      console.log("\n👉 RECOMENDACIÓN: Debemos purgar estos artistas sospechosos y volver a buscarlos");
      console.log("   usando la estrategia 'Ruta del Álbum' (buscar por nombre de álbum, no de artista).");
  }
}

audit();