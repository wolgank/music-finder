//music-vault-server/src/scripts/investigate_mismatch.ts
import db from "../../db";
import "dotenv/config";

// Limpieza de strings para comparar
function cleanString(str: string) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/\(.*\)/g, "")
        .replace(/deluxe|remaster|edition|version|feat\.|live/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

async function investigate() {
  console.log("🕵️‍♂️ BUSCANDO UN CASO DE ERROR ALEATORIO...");
  
  // Traemos todos los artistas con ID (la lista sucia)
  const allArtists = db.prepare(`SELECT id, name, tidal_id FROM artists WHERE tidal_id IS NOT NULL`).all() as any[];
  
  // Barajamos la lista para que sea realmente aleatorio
  const shuffled = allArtists.sort(() => 0.5 - Math.random());

  for (const artist of shuffled) {
      // 1. Historial (Lo que tú escuchaste)
      const historyAlbums = db.prepare(`
          SELECT DISTINCT album_name FROM play_history 
          WHERE artist_name = ? AND album_name IS NOT NULL AND album_name != ''
      `).all(artist.name) as { album_name: string }[];

      if (historyAlbums.length === 0) continue;

      // 2. Base de Datos Local (Lo que Tidal nos dio)
      const harvestedAlbums = db.prepare(`
          SELECT title, id as album_id FROM albums WHERE artist_id = ?
      `).all(artist.id) as { title: string, album_id: string }[];

      if (harvestedAlbums.length === 0) continue;

      // 3. Verificar si coinciden
      const cleanHarvested = harvestedAlbums.map(a => cleanString(a.title));
      let matchFound = false;

      for (const hAlbum of historyAlbums) {
          const cleanHistory = cleanString(hAlbum.album_name);
          if (cleanHarvested.some(t => t.includes(cleanHistory) || cleanHistory.includes(t))) {
              matchFound = true;
              break;
          }
      }

      // SI NO HAY MATCH -> ¡ENCONTRAMOS AL CULPABLE!
      if (!matchFound) {
          console.log(`\n🚨 ¡CASO DE ERROR ENCONTRADO!`);
          console.log(`👤 ARTISTA: \x1b[36m${artist.name}\x1b[0m (Tidal ID guardado: ${artist.tidal_id})`);
          console.log(`---------------------------------------------------------------`);
          
          console.log(`\x1b[32m✅ TU HISTORIAL (Lo que buscas):\x1b[0m`);
          historyAlbums.slice(0, 10).forEach(a => console.log(`   💿 ${a.album_name}`));
          if (historyAlbums.length > 10) console.log(`   ... y ${historyAlbums.length - 10} más.`);

          console.log(`\n\x1b[31m❌ DESCARGADO DE TIDAL (Lo que obtuvimos):\x1b[0m`);
          harvestedAlbums.slice(0, 10).forEach(a => console.log(`   💀 ${a.title}`));
          if (harvestedAlbums.length > 10) console.log(`   ... y ${harvestedAlbums.length - 10} más.`);
          
          console.log(`---------------------------------------------------------------`);
          console.log(`🧐 DIAGNÓSTICO:`);
          console.log(`   Compara las listas. Si los títulos son totalmente diferentes,`);
          console.log(`   significa que Tidal nos dio el ID de OTRO artista con el mismo nombre.`);
          
          return; // Terminamos tras encontrar uno
      }
  }
  
  console.log("✅ Increíblemente, no encontré errores en la muestra aleatoria (¿seguro que hay tantos?)");
}

investigate();