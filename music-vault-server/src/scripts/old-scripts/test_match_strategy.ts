//music-vault-server/src/scripts/test_match_strategy.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

// Función auxiliar para comparar texto flexiblemente
function cleanString(str: string) {
    return str.toLowerCase()
        .replace(/\(.*\)/g, "") // Quitar paradas entre paréntesis
        .replace(/deluxe|remaster|edition|version/g, "")
        .replace(/[^a-z0-9]/g, "") // Solo letras y números
        .trim();
}

async function testStrategy() {
  console.log("🧪 TEST INTEGRAL: ESTRATEGIA 'RUTA DEL ÁLBUM'");
  console.log("--------------------------------------------");

  // 1. ELEGIR UNA CANCIÓN DE UN ARTISTA QUE YA PROCESAMOS
  const song = db.prepare(`
    SELECT 
      ph.track_name, 
      ph.album_name,
      ph.artist_name, 
      a.id as local_artist_uuid,
      a.tidal_id as artist_tidal_id
    FROM play_history ph
    JOIN artists a ON ph.artist_name = a.name
    WHERE a.tidal_id IS NOT NULL 
    AND ph.album_name IS NOT NULL
    ORDER BY RANDOM()
    LIMIT 1
  `).get() as any;

  if (!song) { console.error("❌ No hay datos suficientes."); return; }

  console.log(`🎵 Canción: "${song.track_name}"`);
  console.log(`👤 Artista: "${song.artist_name}" (Tidal ID: ${song.artist_tidal_id})`);
  console.log(`💿 Álbum (Spotify): "${song.album_name}"`);
  console.log("--------------------------------------------");

  // --- PASO 1: BUSCAR ÁLBUM EN NUESTRA DB LOCAL ---
  // Intentamos encontrar el álbum en nuestra tabla 'albums' usando el nombre
  // Esto es mucho más rápido y seguro que preguntar a Tidal
  const localAlbums = db.prepare(`
    SELECT title, tidal_id 
    FROM albums 
    WHERE artist_id = ?
  `).all(song.local_artist_uuid) as { title: string, tidal_id: string }[];

  // Búsqueda difusa del álbum correcto
  let targetAlbumId = null;
  const cleanTargetAlbum = cleanString(song.album_name);

  console.log(`📚 Buscando álbum en ${localAlbums.length} discos guardados localmente...`);
  
  const matchAlbum = localAlbums.find(a => {
      const cleanLocal = cleanString(a.title);
      return cleanLocal.includes(cleanTargetAlbum) || cleanTargetAlbum.includes(cleanLocal);
  });

  if (matchAlbum) {
      console.log(`✅ ¡Álbum encontrado en local!: "${matchAlbum.title}" (ID: ${matchAlbum.tidal_id})`);
      targetAlbumId = matchAlbum.tidal_id;
  } else {
      console.log(`⚠️ Álbum no encontrado exactamente en local. (Puede ser un Single o Remix)`);
      // PLAN B: Si no encontramos el álbum, usamos el "Top Tracks" del artista
  }

  // --- PASO 2: OBTENER CANCIONES (Del Álbum o del Artista) ---
  let tracksToCheck: any[] = [];
  
  if (targetAlbumId) {
      // ESTRATEGIA A: Bajar tracks del álbum (99% Precisión)
      console.log(`⬇️ Descargando tracks del álbum...`);
      const res = await tidal['api'].get(`/v2/albums/${targetAlbumId}/items`, {
          params: { countryCode: "PE", limit: 50 }
      });
      tracksToCheck = res.data.data;
  } else {
      // ESTRATEGIA B: Fallback a Top Tracks del Artista
      console.log(`🔄 Fallback: Buscando en Top Tracks del artista...`);
      const res = await tidal['api'].get(`/v2/artists/${song.artist_tidal_id}/relationships/topHits`, {
          params: { countryCode: "PE", limit: 50, type: "TRACKS" }
      });
      // Nota: relationships/topHits devuelve lista ligera, necesitamos detalles? 
      // Usualmente relationships devuelve data minima. Mejor tracks directo si existe endpoint.
      // Usaremos /artists/:id/items mejor si existe, o el search filtrado.
      // Probemos con Search filtrado por artista si falla el álbum.
      const encodedQuery = encodeURIComponent(`${song.artist_name} ${song.track_name}`);
      const searchRes = await tidal['api'].get(`/v2/searchResults/${encodedQuery}/relationships/tracks`, {
           params: { countryCode: "PE", limit: 5 }
      });
      const candidates = searchRes.data.data || [];
      if (candidates.length > 0) {
          const ids = candidates.map((c:any) => c.id).join(",");
          const det = await tidal['api'].get(`/v2/tracks`, { params: { "filter[id]": ids, countryCode: "PE" } });
          tracksToCheck = det.data.data;
      }
  }

  // --- PASO 3: MATCH FINAL DE LA CANCIÓN ---
  console.log(`🧐 Comparando contra ${tracksToCheck.length} candidatos...`);
  
  const cleanTitleTarget = cleanString(song.track_name);
  
  const finalMatch = tracksToCheck.find(t => {
      const cleanCand = cleanString(t.attributes.title);
      return cleanCand === cleanTitleTarget || cleanCand.includes(cleanTitleTarget) || cleanTitleTarget.includes(cleanCand);
  });

  if (finalMatch) {
      console.log("\n🎉 ¡MATCH CONFIRMADO!");
      console.log(`   📝 Original: ${song.track_name}`);
      console.log(`   🎵 Tidal:    ${finalMatch.attributes.title}`);
      console.log(`   🆔 Tidal ID: ${finalMatch.id}`);
      console.log(`   💿 ISRC:     ${finalMatch.attributes.isrc}`);
      console.log(`   ⏱️ Duración: ${finalMatch.attributes.duration}`);
  } else {
      console.log("\n❌ No se encontró la canción exacta.");
      console.log("Lista de candidatos revisados:");
      tracksToCheck.forEach(t => console.log(`   - ${t.attributes.title}`));
  }
}

testStrategy();