//music-vault-server/src/scripts/view_verified.ts
import db from "../../db";
import "dotenv/config";

function cleanString(str: string) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/\(.*\)/g, "")
        .replace(/deluxe|remaster|edition|version|feat\.|live/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

async function viewVerified() {
  console.log("✅ MOSTRANDO SOLO ARTISTAS VERIFICADOS (100% CONFIRMADOS)");
  console.log("-------------------------------------------------------");

  const artists = db.prepare(`SELECT id, name, tidal_id FROM artists WHERE tidal_id IS NOT NULL`).all() as any[];
  
  let verifiedCount = 0;

  for (const artist of artists) {
    // 1. Qué escuchaste tú
    const historyAlbums = db.prepare(`
        SELECT DISTINCT album_name FROM play_history 
        WHERE artist_name = ? AND album_name IS NOT NULL AND album_name != ''
    `).all(artist.name) as { album_name: string }[];

    if (historyAlbums.length === 0) continue;

    // 2. Qué bajamos de Tidal
    const harvestedAlbums = db.prepare(`SELECT title FROM albums WHERE artist_id = ?`).all(artist.id) as { title: string }[];
    
    if (harvestedAlbums.length === 0) continue;

    // 3. Buscar coincidencia
    const cleanHarvested = harvestedAlbums.map(a => cleanString(a.title));
    let match = null;

    for (const hAlbum of historyAlbums) {
        const cleanHistory = cleanString(hAlbum.album_name);
        if (cleanHarvested.some(t => t.includes(cleanHistory) || cleanHistory.includes(t))) {
            match = hAlbum.album_name; // Guardamos el nombre del álbum que hizo el match
            break;
        }
    }

    // 4. SOLO IMPRIMIR SI HAY MATCH
    if (match) {
        verifiedCount++;
        // Imprimimos limpio y ordenado
        console.log(`🟢 \x1b[32m${artist.name}\x1b[0m`); 
        console.log(`   🔗 ID Correcto: ${artist.tidal_id}`);
        console.log(`   💿 Match confirmado por: "${match}"`);
        console.log("-------------------------------------------------------");
    }
  }

  console.log(`\n🏆 Total de Artistas Salvables: ${verifiedCount} de ${artists.length}`);
  
  if (verifiedCount < artists.length * 0.1) {
      console.log("\n⚠️  ALERTA: El porcentaje de aciertos es muy bajo.");
      console.log("   Esto confirma que la estrategia 'Solo Nombre' falló.");
      console.log("   SOLUCIÓN: Debemos borrar la tabla 'artists' y volver a llenar usando");
      console.log("   la estrategia 'Artista + Álbum' que probamos en el script anterior.");
  }
}

viewVerified();