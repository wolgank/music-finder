import { Database } from "bun:sqlite";

const db = new Database("music_vault.db");

console.log("🛠️  Iniciando actualización de esquema para canciones...");

// 1. CREAR TABLA DE CANCIONES (TRACKS)
// Esta es la tabla maestra con la info técnica clave
db.run(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,           -- UUID local
    title TEXT NOT NULL,
    duration_ms INTEGER,
    isrc TEXT,                     -- Identificador universal (DNI de la canción)
    track_number INTEGER,
    volume_number INTEGER,
    tidal_id TEXT UNIQUE,          -- ID de Tidal para evitar duplicados
    album_id TEXT,                 -- Relación con nuestra tabla 'albums'
    FOREIGN KEY (album_id) REFERENCES albums(id)
  )
`);
console.log("✅ Tabla 'tracks' lista.");

// 2. CREAR ÍNDICES PARA BÚSQUEDA RÁPIDA
// Esto hará que el buscador inteligente sea instantáneo
db.run("CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title)");
console.log("✅ Índices de optimización creados.");

// 3. AGREGAR COLUMNA 'processed' A PLAY_HISTORY
// Esto sirve para saber qué canciones del historial ya vinculamos a la tabla tracks
try {
    db.run("ALTER TABLE play_history ADD COLUMN track_id TEXT REFERENCES tracks(id)");
    console.log("✅ Columna 'track_id' añadida a 'play_history'.");
} catch (e) {
    console.log("ℹ️  La columna 'track_id' ya existía en 'play_history'.");
}

console.log("\n🏁 Base de datos preparada para la cosecha de canciones.");