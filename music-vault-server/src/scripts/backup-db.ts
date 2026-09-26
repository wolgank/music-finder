//backup-db.ts
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BACKUPS_DIR, DB_PATH } from '../paths';

async function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(BACKUPS_DIR, `music_vault_backup_${timestamp}.db`);

    try {
        if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
        if (!existsSync(DB_PATH)) {
            console.error(`🔴 No se encontró la DB en: ${DB_PATH}`);
            return false;
        }

        console.log(`💾 Creando backup en: ${backupPath}...`);
        cpSync(DB_PATH, backupPath);
        console.log("✅ Backup completado con éxito.");
        return true;
    } catch (error) {
        console.error("🔴 Error al crear el backup:", error);
        return false;
    }
}

createBackup();
