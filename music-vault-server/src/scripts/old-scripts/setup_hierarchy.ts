// src/scripts/setup_hierarchy.ts
import { Database } from "bun:sqlite";

const db = new Database("music_vault.db");
console.log("🏗️  Creando tablas de Jerarquía (Artistas y Álbumes)...");

// 1. Tabla ARTISTAS
db.run(`
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,      -- Nuestro UUID
    name TEXT NOT NULL,       -- Nombre limpio
    tidal_id TEXT UNIQUE,     -- ID de Tidal (4761957)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 2. Tabla ÁLBUMES
db.run(`
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,      -- Nuestro UUID
    title TEXT NOT NULL,
    artist_id TEXT NOT NULL,  -- FK a nuestra tabla artists
    tidal_id TEXT,            -- ID de Tidal del álbum
    image_url TEXT,           -- ¡Aquí guardamos la foto una sola vez!
    FOREIGN KEY(artist_id) REFERENCES artists(id)
  );
`);

// 3. Índices para velocidad
db.run("CREATE INDEX IF NOT EXISTS idx_artist_name ON artists(name);");
db.run("CREATE INDEX IF NOT EXISTS idx_album_title ON albums(title);");

console.log("✅ Tablas listas. Ahora podemos llenar la jerarquía.");