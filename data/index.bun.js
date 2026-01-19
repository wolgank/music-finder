import { readdir } from "node:fs/promises";

// Configuración
const OUTPUT_FILE = "resumen_musical.json";

async function main() {
  console.time("⏱️ Tiempo de procesamiento");
  console.log("🚀 Iniciando análisis de tu historial de Spotify con Bun...");

  // 1. Encontrar los archivos JSON
  const allFiles = await readdir(".");
  const historyFiles = allFiles.filter(file => 
    file.includes("Streaming_History") && file.endsWith(".json")
  );

  if (historyFiles.length === 0) {
    console.error("❌ No encontré archivos de historial. Asegúrate de estar en la carpeta correcta.");
    return;
  }

  console.log(`📂 Se encontraron ${historyFiles.length} archivos para procesar.`);

  // Estructura de datos para agrupar
  // { "Artista": { totalMs: 0, tracks: { "Cancion": { plays: 0, ms: 0 } } } }
  const library = {};
  
  // Estadísticas globales
  let globalStats = {
    total_plays: 0,
    total_ms_played: 0,
    total_hours: 0,
    unique_artists: 0,
    unique_tracks: 0
  };

  // 2. Procesar cada archivo
  for (const filename of historyFiles) {
    console.log(`   📄 Leyendo: ${filename}`);
    const file = Bun.file(filename);
    const data = await file.json();

    for (const record of data) {
      // Validamos que tenga artista y canción (a veces los podcasts vienen null)
      const artist = record.master_metadata_album_artist_name;
      const track = record.master_metadata_track_name;
      const ms = record.ms_played || 0;

      if (!artist || !track) continue;

      // Inicializar artista si no existe
      if (!library[artist]) {
        library[artist] = {
          artist_name: artist,
          total_artist_ms: 0,
          total_artist_plays: 0,
          tracks: {}
        };
      }

      // Actualizar datos del artista
      library[artist].total_artist_ms += ms;
      library[artist].total_artist_plays += 1;

      // Inicializar canción si no existe
      if (!library[artist].tracks[track]) {
        library[artist].tracks[track] = {
          track_name: track,
          plays: 0,
          ms_played: 0
        };
      }

      // Actualizar datos de la canción
      library[artist].tracks[track].plays += 1;
      library[artist].tracks[track].ms_played += ms;

      // Actualizar globales
      globalStats.total_plays += 1;
      globalStats.total_ms_played += ms;
    }
  }

  // 3. Formatear y Ordenar (La parte "Bonita")
  console.log("🧹 Ordenando y embelleciendo los datos...");

  const sortedLibrary = Object.values(library).map(artistData => {
    // Convertir el objeto de tracks a un array y ordenarlo por reproducciones
    const sortedTracks = Object.values(artistData.tracks).sort((a, b) => b.plays - a.plays);
    
    return {
      artist: artistData.artist_name,
      stats: {
        total_plays: artistData.total_artist_plays,
        total_minutes: Math.round(artistData.total_artist_ms / 60000) // Convertir a minutos para lectura fácil
      },
      top_tracks: sortedTracks // Canciones ordenadas de mayor a menor
    };
  }).sort((a, b) => b.stats.total_plays - a.stats.total_plays); // Ordenar artistas por quién escuchaste más

  // Finalizar estadísticas globales
  globalStats.total_hours = (globalStats.total_ms_played / (1000 * 60 * 60)).toFixed(2);
  globalStats.unique_artists = sortedLibrary.length;
  globalStats.unique_tracks = sortedLibrary.reduce((acc, curr) => acc + curr.top_tracks.length, 0);

  // Objeto final
  const finalOutput = {
    generated_at: new Date().toISOString(),
    global_summary: globalStats,
    my_music: sortedLibrary
  };

  // 4. Guardar archivo
  await Bun.write(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2));

  console.timeEnd("⏱️ Tiempo de procesamiento");
  console.log(`✅ ¡Listo! Tu resumen está en: ${OUTPUT_FILE}`);
  console.log(`📊 Resumen rápido: ${globalStats.unique_artists} artistas y ${globalStats.unique_tracks} canciones procesadas.`);
}

main();