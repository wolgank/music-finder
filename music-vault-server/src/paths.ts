import { mkdirSync } from "fs";
import { join } from "path";

/** Raíz de music-vault-server (un nivel arriba de src/) */
export const ROOT_DIR = join(import.meta.dir, "..");

/** Datos runtime: DB, índices, reportes */
export const DATA_DIR = join(ROOT_DIR, "data");
export const REPORTS_DIR = join(DATA_DIR, "reports");
export const BACKUPS_DIR = join(ROOT_DIR, "backups");

export const DB_PATH = join(DATA_DIR, "music_vault.db");
export const LIBRARY_INDEX_PATH = join(DATA_DIR, "library_index.json");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(BACKUPS_DIR, { recursive: true });
