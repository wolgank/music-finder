import { spawn } from 'child_process';
import * as fs from 'fs';

const LOG_FILE = 'harvest_execution.log';

async function runScript(scriptPath: string): Promise<number> {
    return new Promise((resolve) => {
        console.log(`\n >>> INICIANDO: ${scriptPath} <<< \n`);
        
        const child = spawn('bun', [scriptPath], {
            stdio: 'inherit', // Mantiene los colores y formato en la terminal
            env: { ...process.env, FORCE_COLOR: '1' }
        });

        child.on('close', (code) => {
            console.log(`\n >>> FINALIZADO: ${scriptPath} (Código: ${code}) <<< \n`);
            resolve(code || 0);
        });
    });
}

async function main() {
    const startTime = new Date().toLocaleString();
    fs.appendFileSync(LOG_FILE, `\n=== SESIÓN INICIADA: ${startTime} ===\n`);

    console.log("🛠️  Iniciando Orquestador de Cosecha (Modo 2 Horas)...");

    // PASO 1: Buscar Álbumes Faltantes
    // Este llena la tabla 'albums' con lo que falta en el historial
    await runScript('src/scripts/harvest-missing-albums.ts');

    console.log("⏳ Esperando 10 segundos para refrescar DB...");
    await new Promise(r => setTimeout(r, 10000));

    // PASO 2: Extraer Tracks de los álbumes encontrados
    // Este llena la tabla 'tracks' y mapea el library_index.json
    await runScript('src/scripts/harvest-tracks.ts');

    const endTime = new Date().toLocaleString();
    console.log(`\n✅ TODO COMPLETADO. Inicio: ${startTime} | Fin: ${endTime}`);
    fs.appendFileSync(LOG_FILE, `=== SESIÓN FINALIZADA: ${endTime} ===\n`);
}

main();