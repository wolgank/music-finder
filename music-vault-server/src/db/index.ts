// music-vault-server/src/db/index.ts
import { Database } from "bun:sqlite";

const db = new Database("music_vault.db", { create: true });
db.exec("PRAGMA journal_mode = WAL;");

console.log("🗄️  Base de Datos conectada: music_vault.db");

// --- 1. HISTORIAL CRUDO (Tu pasado en Spotify) ---
db.run(`
  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts DATETIME,
    ms_played INTEGER,
    track_name TEXT,
    artist_name TEXT,
    album_name TEXT,
    platform TEXT,
    reason_start TEXT,
    reason_end TEXT,
    shuffle BOOLEAN,
    skipped BOOLEAN,
    
    -- Flag para saber si ya lo procesamos
    processed BOOLEAN DEFAULT 0
  );
`);

// --- 2. FICHA MAESTRA (Tu Identidad Musical) ---
// Solo datos universales. Nada de IDs de Tidal aquí.
db.run(`
  CREATE TABLE IF NOT EXISTS library_tracks (
    id TEXT PRIMARY KEY,          -- UUID generado por nosotros
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    duration_seconds INTEGER,
    isrc TEXT,                    -- El DNI Universal
    image_url TEXT,               -- Portada en alta calidad
    explicit BOOLEAN,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- 3. CONEXIONES (El Puente) ---
// Aquí vinculamos tu UUID con el ID de Tidal (y a futuro Spotify/Apple)
db.run(`
  CREATE TABLE IF NOT EXISTS platform_links (
    track_id TEXT NOT NULL,       -- Link a library_tracks
    platform TEXT NOT NULL,       -- 'tidal', 'spotify', 'local'
    external_id TEXT NOT NULL,    -- Ej: '86353029'
    url TEXT,
    status TEXT DEFAULT 'active',
    PRIMARY KEY (platform, external_id),
    FOREIGN KEY(track_id) REFERENCES library_tracks(id) ON DELETE CASCADE
  );
`);

// --- 4. INTELIGENCIA (Futuro Mood Tuner) ---
// Dejamos la tabla creada pero vacía por ahora
db.run(`
  CREATE TABLE IF NOT EXISTS audio_features (
    track_id TEXT PRIMARY KEY,
    bpm REAL,
    energy REAL,
    danceability REAL,
    valence REAL,
    FOREIGN KEY(track_id) REFERENCES library_tracks(id) ON DELETE CASCADE
  );
`);

// 5. Control de importaciones
db.run(`
  CREATE TABLE IF NOT EXISTS imported_files (
    filename TEXT PRIMARY KEY,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;