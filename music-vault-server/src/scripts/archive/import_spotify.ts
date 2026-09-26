import { readdir } from "node:fs/promises";
import { join } from "node:path";
import db from "../../db";

// Ajusta la ruta relativa para salir de: src -> scripts -> server -> root -> data
const DATA_DIR = "../data"; 

async function main() {
  console.log("🏗️  Iniciando importación masiva de Spotify History...");
  
  // 1. Encontrar archivos JSON
  // Como el script corre desde la raíz del proyecto, ajustamos la búsqueda
  const allFiles = await readdir(join(process.cwd(), DATA_DIR));
  
  const historyFiles = allFiles.filter(f => 
    f.includes("Streaming_History") && f.endsWith(".json")
  );

  console.log(`📂 Se encontraron ${historyFiles.length} archivos potenciales.`);

  // Preparamos las sentencias SQL (Prepared Statements son MUCHO más rápidos)
  const checkFile = db.prepare("SELECT filename FROM imported_files WHERE filename = ?");
  const markFile = db.prepare("INSERT INTO imported_files (filename) VALUES (?)");
  
  const insertPlay = db.prepare(`
    INSERT INTO play_history (
      ts, ms_played, track_name, artist_name, album_name, 
      platform, reason_start, reason_end, shuffle, skipped
    ) VALUES (
      $ts, $ms, $track, $artist, $album, 
      $platform, $r_start, $r_end, $shuffle, $skipped
    )
  `);

  // Usamos una transacción para que la inserción sea atómica y VELOZ
  const insertMany = db.transaction((plays: any[]) => {
    for (const play of plays) {
      insertPlay.run(play);
    }
  });

  let totalImported = 0;

  for (const filename of historyFiles) {
    // Verificar si ya se importó
    if (checkFile.get(filename)) {
      console.log(`⏭️  Saltando ${filename} (Ya importado)`);
      continue;
    }

    console.log(`Processing: ${filename}...`);
    
    const filePath = join(process.cwd(), DATA_DIR, filename);
    const file = Bun.file(filePath);
    const data = await file.json();

    const cleanData = [];

    // Limpieza y Mapeo de datos
    for (const record of data) {
      // Validamos que sea una canción real (a veces hay nulls o podcasts sin artista)
      if (!record.master_metadata_track_name || !record.master_metadata_album_artist_name) continue;

      cleanData.push({
        $ts: record.ts,
        $ms: record.ms_played,
        $track: record.master_metadata_track_name,
        $artist: record.master_metadata_album_artist_name,
        $album: record.master_metadata_album_album_name,
        $platform: record.platform,
        $r_start: record.reason_start,
        $r_end: record.reason_end,
        $shuffle: record.shuffle ? 1 : 0, // SQLite usa 1/0 para booleans
        $skipped: record.skipped ? 1 : 0
      });
    }

    // Insertar lote en la DB
    insertMany(cleanData);
    
    // Marcar archivo como procesado
    markFile.run(filename);
    
    console.log(`✅ Importados ${cleanData.length} registros de ${filename}`);
    totalImported += cleanData.length;
  }

  console.log(`\n🎉 ¡Proceso Finalizado! Total registros nuevos: ${totalImported}`);
}

main();