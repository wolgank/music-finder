import db from "../../db";

console.log("⚡ Optimizando base de datos para búsqueda instantánea...");

db.transaction(() => {
    // 1. Crear columnas normalizadas para evitar usar LOWER() en las consultas
    try {
        db.run("ALTER TABLE play_history ADD COLUMN album_name_clean TEXT");
        db.run("ALTER TABLE play_history ADD COLUMN artist_name_clean TEXT");
        db.run("ALTER TABLE albums ADD COLUMN title_clean TEXT");
        db.run("ALTER TABLE artists ADD COLUMN name_clean TEXT");
    } catch (e) {
        console.log("ℹ️ Las columnas ya existen.");
    }

    console.log("📝 Normalizando nombres (esto es rápido)...");
    db.run("UPDATE play_history SET album_name_clean = lower(album_name), artist_name_clean = lower(artist_name)");
    db.run("UPDATE albums SET title_clean = lower(title)");
    db.run("UPDATE artists SET name_clean = lower(name)");

    console.log("🚀 Creando índices sobre nombres limpios...");
    db.run("CREATE INDEX IF NOT EXISTS idx_ph_clean ON play_history(album_name_clean, artist_name_clean)");
    db.run("CREATE INDEX IF NOT EXISTS idx_alb_clean ON albums(title_clean)");
    db.run("CREATE INDEX IF NOT EXISTS idx_art_clean ON artists(name_clean)");
})();

console.log("✅ DB Optimizada. Ahora el script de cosecha será instantáneo.");