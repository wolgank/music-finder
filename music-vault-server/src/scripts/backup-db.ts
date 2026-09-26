//backup-db.ts
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

async function createBackup() {
    const dbPath = './music_vault.db';
    const backupDir = './backups';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(backupDir, `music_vault_backup_${timestamp}.db`);

    try {
        if (!existsSync(backupDir)) mkdirSync(backupDir);
        
        console.log(`💾 Creando backup en: ${backupPath}...`);
        cpSync(dbPath, backupPath);
        console.log("✅ Backup completado con éxito.");
        return true;
    } catch (error) {
        console.error("🔴 Error al crear el backup:", error);
        return false;
    }
}

createBackup();