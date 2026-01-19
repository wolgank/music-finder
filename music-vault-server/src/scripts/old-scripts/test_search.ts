// music-vault-server/src/scripts/test_search.ts
import { TidalClient } from "../../lib/tidal/client";
import db from "../../db";
import { randomUUID } from "crypto";
import "dotenv/config"; 

const tidal = new TidalClient(
  process.env.TIDAL_CLIENT_ID!,
  process.env.TIDAL_CLIENT_SECRET!
);

async function test() {
  // DATOS DE PRUEBA
  const mySong = {
      title: "Call Out My Name",
      artist: "The Weeknd",
      album: "My Dear Melancholy,"
  };

  console.log(`🎯 Testeando búsqueda y estructura de datos para: "${mySong.title}"`);

  // 1. BUSCAR
  const result = await tidal.findExactTrack(mySong);

  if (!result) {
    console.error("❌ Falló la búsqueda. No podemos probar la base de datos.");
    return;
  }

  console.log("✅ Datos obtenidos de Tidal correctamente:");
  console.log(`   Nombre: ${result.name}`);
  console.log(`   ISRC:   ${result.isrc}`);
  console.log(`   Imagen: ${result.image}`);
  console.log(`   Duración: ${result.duration}s`);

  // 2. SIMULAR GUARDADO EN DB (Test de Integridad)
  console.log("\n💾 Simulando inserción en tablas 'library_tracks' y 'platform_links'...");

  const transaction = db.transaction(() => {
    const fakeUUID = randomUUID(); // Generamos un ID nuevo
    
    // Intento insertar en Maestra
    db.prepare(`
      INSERT INTO library_tracks (id, title, artist, album, duration_seconds, isrc, image_url, explicit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fakeUUID, 
      result.name, 
      result.artist, 
      result.album, 
      result.duration, 
      result.isrc, 
      result.image, 
      result.explicit ? 1 : 0
    );

    // Intento insertar en Enlace
    db.prepare(`
      INSERT INTO platform_links (track_id, platform, external_id, url)
      VALUES (?, ?, ?, ?)
    `).run(
      fakeUUID,
      'tidal',
      result.id,
      result.url
    );

    console.log(`✨ ¡ÉXITO! Se guardó temporalmente con UUID: ${fakeUUID}`);
    // IMPORTANTE: Al ser un test, hacemos rollback para no ensuciar la BD real
    throw new Error("ROLLBACK_TEST"); 
  });

  try {
    transaction();
  } catch (err: any) {
    if (err.message === "ROLLBACK_TEST") {
      console.log("🔄 Test finalizado. Datos revertidos (la base de datos sigue limpia).");
      console.log("✅ CONCLUSIÓN: El esquema de base de datos acepta perfectamente los datos de Tidal.");
    } else {
      console.error("❌ ERROR CRÍTICO EN BASE DE DATOS:", err.message);
    }
  }
}

test();