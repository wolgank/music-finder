import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

async function testOne() {
  console.log("🧪 INICIANDO TEST UNITARIO: ARTISTA + ÁLBUMES");
  console.log("-------------------------------------------");

  // 0. ASEGURAR TABLAS (Por si no corriste el setup)
  db.run(`CREATE TABLE IF NOT EXISTS artists (id TEXT PRIMARY KEY, name TEXT NOT NULL, tidal_id TEXT UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  db.run(`CREATE TABLE IF NOT EXISTS albums (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist_id TEXT NOT NULL, tidal_id TEXT, image_url TEXT, FOREIGN KEY(artist_id) REFERENCES artists(id));`);

  // 1. SELECCIONAR UN ARTISTA RANDOM DEL HISTORIAL
  // Usamos RANDOM() para que cada vez que corras el test sea uno diferente
  const randomArtist = db.prepare(`
    SELECT DISTINCT artist_name 
    FROM play_history 
    WHERE artist_name IS NOT NULL 
    ORDER BY RANDOM() 
    LIMIT 1
  `).get() as { artist_name: string };

  if (!randomArtist) {
    console.error("❌ No hay artistas en tu historial 'play_history'.");
    return;
  }

  const artistName = randomArtist.artist_name.trim();
  console.log(`🎲 Artista seleccionado: "${artistName}"`);

  try {
    // 2. BUSCAR ARTISTA (Estrategia: Search Rel -> Get Details -> Strict Filter)
    console.log(`📡 Buscando ID en Tidal...`);
    
    const encodedName = encodeURIComponent(artistName);
    
    // Paso A: Obtener IDs candidatos
    const searchRes = await tidal['api'].get(`/v2/searchResults/${encodedName}/relationships/artists`, {
        params: { countryCode: "PE", limit: 3 }
    });
    const candidates = searchRes.data.data || [];

    if (candidates.length === 0) {
        console.log("⚠️ Tidal no devolvió candidatos.");
        return;
    }

    // Paso B: Obtener detalles para comparar nombres
    const candidateIds = candidates.map((c: any) => c.id).join(",");
    const detailsRes = await tidal['api'].get(`/v2/artists`, {
        params: { "filter[id]": candidateIds, countryCode: "PE" }
    });
    
    const fullCandidates = detailsRes.data.data;

    // Paso C: Filtro Estricto (Case Insensitive)
    const match = fullCandidates.find((c: any) => 
        c.attributes.name.toLowerCase() === artistName.toLowerCase()
    );

    if (!match) {
        console.log(`❌ No hubo coincidencia exacta. Candidatos vistos: ${fullCandidates.map((c:any) => c.attributes.name).join(", ")}`);
        return;
    }

    const tidalArtistId = match.id;
    console.log(`✅ ¡MATCH! ID Oficial: ${tidalArtistId} (${match.attributes.name})`);

    // 3. OBTENER ÁLBUMES (Usando include=albums)
    console.log(`📚 Descargando álbumes...`);
    const albumRes = await tidal['api'].get(`/v2/artists/${tidalArtistId}`, {
        params: { countryCode: "PE", include: "albums" }
    });

    // En la respuesta JSON:API, los álbumes están en 'included'
    const includedData = albumRes.data.included || [];
    const albumsFound = includedData.filter((x: any) => x.type === "albums");

    console.log(`💿 Tidal reporta ${albumsFound.length} lanzamientos (Álbumes/Singles/EPs).`);

    // 4. SIMULAR GUARDADO (Y Guardar real para verificar)
    const myArtistUUID = randomUUID();
    
    // Guardamos Artista
    db.prepare("INSERT OR IGNORE INTO artists (id, name, tidal_id) VALUES (?, ?, ?)").run(myArtistUUID, artistName, tidalArtistId);
    console.log(`💾 Artista guardado en DB.`);

    const insertAlbum = db.prepare("INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url) VALUES (?, ?, ?, ?, ?)");
    
    let savedCount = 0;
    for (const album of albumsFound) {
        const attr = album.attributes;
        
        // Construir URL de imagen si existe cover
        let coverUrl = null;
        // Intentamos sacar el cover del atributo directo (común en includes)
        if (attr.cover) {
             const path = attr.cover.replace(/-/g, '/'); 
             coverUrl = `https://resources.tidal.com/images/${path}/640x640.jpg`;
        }

        // Solo para el test, imprimimos los primeros 3 álbumes encontrados
        if (savedCount < 3) {
            console.log(`   ➡️  [${attr.type}] ${attr.title} (Cover: ${coverUrl ? '✅' : '❌'})`);
        }

        insertAlbum.run(randomUUID(), attr.title, myArtistUUID, album.id, coverUrl);
        savedCount++;
    }

    console.log(`\n✨ ÉXITO TOTAL. Se guardaron ${savedCount} álbumes para ${artistName}.`);
    console.log("Verifica tu base de datos si quieres confirmar.");

  } catch (e: any) {
    console.error("❌ Error en el test:", e.message);
    if (e.response) {
        console.log("Detalle:", JSON.stringify(e.response.data, null, 2));
    }
  }
}

testOne();