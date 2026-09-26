// music-vault-server/src/scripts/migrate_db.ts
import { Database } from "bun:sqlite";

console.log("🚑 Iniciando reparación de la base de datos...");

const db = new Database("music_vault.db");

// 1. SALVAR PLAY HISTORY
// Verificamos que play_history exista
const historyCount = db.prepare("SELECT count(*) as c FROM play_history").get() as { c: number };
console.log(`📊 Tienes ${historyCount.c} canciones en tu historial. ¡No las tocaremos!`);

// 2. ACTUALIZAR PLAY HISTORY
// Necesitamos agregar la columna 'processed' si no existe
try {
    console.log("🛠️  Agregando columna 'processed' a play_history...");
    db.run("ALTER TABLE play_history ADD COLUMN processed BOOLEAN DEFAULT 0;");
} catch (e) {
    console.log("ℹ️  La columna 'processed' ya existía.");
}

// 3. REINICIAR LAS TABLAS DE CATÁLOGO
// Borramos library_tracks vieja porque le faltan columnas (ISRC, Image) y es más fácil recrearla que parcharla
console.log("🧹 Borrando tablas de catálogo antiguas...");
db.run("DROP TABLE IF EXISTS library_tracks;");
// platform_links y audio_features son nuevas, pero por si acaso
db.run("DROP TABLE IF EXISTS platform_links;");
db.run("DROP TABLE IF EXISTS audio_features;");

// 4. CREAR TABLAS NUEVAS (Esquema Hub & Spoke)
console.log("🏗️  Creando nuevas tablas maestras...");

// library_tracks (Con ISRC e Imagen)
db.run(`
  CREATE TABLE library_tracks (
    id TEXT PRIMARY KEY,          
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    duration_seconds INTEGER,
    isrc TEXT,                    
    image_url TEXT,               
    explicit BOOLEAN,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// platform_links
db.run(`
  CREATE TABLE platform_links (
    track_id TEXT NOT NULL,       
    platform TEXT NOT NULL,       
    external_id TEXT NOT NULL,    
    url TEXT,
    status TEXT DEFAULT 'active',
    PRIMARY KEY (platform, external_id),
    FOREIGN KEY(track_id) REFERENCES library_tracks(id) ON DELETE CASCADE
  );
`);

// audio_features
db.run(`
  CREATE TABLE audio_features (
    track_id TEXT PRIMARY KEY,
    bpm REAL,
    energy REAL,
    danceability REAL,
    valence REAL,
    FOREIGN KEY(track_id) REFERENCES library_tracks(id) ON DELETE CASCADE
  );
`);

console.log("✅ ¡Migración completada con éxito!");
console.log("👉 Ahora puedes ejecutar 'bun src/scripts/test_search.ts' sin errores.");