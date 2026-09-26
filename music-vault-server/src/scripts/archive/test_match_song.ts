//music-vault-server/src/scripts/test_match_song.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

async function testMatchSong() {
  console.log("🧪 TEST UNITARIO: BÚSQUEDA DE CANCIÓN (VALIDACIÓN POR ID)");
  console.log("---------------------------------------------------------");

  // 1. ELEGIR UNA CANCIÓN AL AZAR DEL HISTORIAL
  // Pero solo de artistas que YA HEMOS RESUELTO (que tienen tidal_id)
  const query = `
    SELECT 
      ph.track_name, 
      ph.artist_name, 
      a.tidal_id as trusted_artist_id,
      a.name as trusted_artist_name
    FROM play_history ph
    JOIN artists a ON ph.artist_name = a.name
    WHERE a.tidal_id IS NOT NULL
    ORDER BY RANDOM()
    LIMIT 1
  `;

  const song = db.prepare(query).get() as { 
    track_name: string, 
    artist_name: string, 
    trusted_artist_id: string,
    trusted_artist_name: string
  };

  if (!song) {
    console.error("❌ No tienes canciones de artistas validados en la base de datos.");
    return;
  }

  console.log(`🎲 Canción seleccionada:`);
  console.log(`   🎵 Título:  "${song.track_name}"`);
  console.log(`   👤 Artista (Historial): "${song.artist_name}"`);
  console.log(`   🔐 ID Validado (DB):     ${song.trusted_artist_id} (${song.trusted_artist_name})`);
  console.log("---------------------------------------------------------");

  try {
    // 2. BÚSQUEDA AMPLIA EN TIDAL
    // Usamos el nombre del historial para buscar, porque Tidal es bueno con "fuzzy search"
    const searchQuery = `${song.artist_name} ${song.track_name}`;
    console.log(`📡 Buscando en Tidal: "${searchQuery}"...`);

    const searchRes = await tidal['api'].get(`/v2/searchResults/${encodeURIComponent(searchQuery)}/relationships/tracks`, {
        params: { countryCode: "PE", limit: 5 }
    });

    const candidates = searchRes.data.data || [];

    if (candidates.length === 0) {
        console.log("⚠️  Tidal no devolvió resultados para esta búsqueda.");
        return;
    }

    // 3. OBTENER DETALLES COMPLETOS PARA VER LOS IDs DE LOS ARTISTAS
    // Aquí es donde aplicamos tu "bala de plata": El ID.
    const candidateIds = candidates.map((c: any) => c.id).join(",");
    
    // Pedimos incluir 'artists' para ver quién canta la canción
    const detailsRes = await tidal['api'].get(`/v2/tracks`, {
        params: { 
            "filter[id]": candidateIds, 
            countryCode: "PE",
            include: "artists,albums"
        }
    });

    const fullTracks = detailsRes.data.data;
    const included = detailsRes.data.included || [];

    // 4. EL FILTRO SUPREMO (MATCHING LOGIC)
    let match = null;

    for (const track of fullTracks) {
        // Buscamos los artistas de ESTA canción en el array 'included'
        // La relación está en track.relationships.artists.data
        const trackArtistRels = track.relationships?.artists?.data || [];
        
        // Verificamos si NUESTRO ID CONFIABLE está en la lista de artistas de este track
        const isArtistMatch = trackArtistRels.some((rel: any) => rel.id === song.trusted_artist_id);

        console.log(`   🧐 Revisando candidato: "${track.attributes.title}"...`);
        
        if (isArtistMatch) {
            // ¡BINGO! El ID coincide.
            // Ahora verificamos el nombre de la canción (Match flexible)
            const trackName = track.attributes.title.toLowerCase();
            const searchName = song.track_name.toLowerCase();

            // Limpieza básica (quitar (Remastered), etc) para comparar texto
            const cleanTrackName = trackName.split("(")[0].trim();
            const cleanSearchName = searchName.split("(")[0].trim();

            if (trackName.includes(cleanSearchName) || cleanSearchName.includes(cleanTrackName)) {
                console.log(`      ✅ ¡MATCH DE ARTISTA (ID) Y TÍTULO!`);
                
                // Recuperar datos extra para mostrar
                const albumRel = track.relationships?.albums?.data?.[0];
                const albumObj = albumRel ? included.find((x: any) => x.type === "albums" && x.id === albumRel.id) : null;
                let coverUrl = "null";
                if (albumObj?.attributes?.cover) {
                    coverUrl = `https://resources.tidal.com/images/${albumObj.attributes.cover.replace(/-/g, '/')}/320x320.jpg`;
                }

                match = {
                    title: track.attributes.title,
                    album: albumObj?.attributes?.title,
                    isrc: track.attributes.isrc,
                    duration: track.attributes.duration,
                    cover: coverUrl,
                    url: track.attributes.url
                };
                break; // Dejamos de buscar
            } else {
                console.log(`      ⚠️  El artista es correcto (ID coinciden), pero el título no se parece.`);
            }
        } else {
            console.log(`      ❌ Artista incorrecto (IDs no coinciden).`);
        }
    }

    console.log("---------------------------------------------------------");
    if (match) {
        console.log("🎉 RESULTADO FINAL:");
        console.log(match);
        console.log("✅ Conclusión: El script funciona incluso si cambiaste el nombre del artista,");
        console.log("   porque usamos el ID numérico para verificar.");
    } else {
        console.log("❌ No se encontró coincidencia exacta.");
        console.log("Posible causa: El título de la canción es muy diferente en Tidal o es un remix no listado.");
    }

  } catch (e: any) {
    console.error("❌ Error:", e.message);
  }
}

testMatchSong();