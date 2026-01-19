import db from '../db';
import * as fs from 'fs';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query: string): Promise<string> => new Promise((resolve) => rl.question(query, resolve));

async function fixNullArtists() {
    const DECISIONS_FILE = 'cleanup_decisions.json';
    console.log("🛠️  INICIANDO REPARACIÓN DE ARTISTAS SIN TIDAL ID...");

    // 1. Obtener artistas que tienen tidal_id en NULL
    const nullArtists = db.prepare("SELECT id, name FROM artists WHERE tidal_id IS NULL").all() as any[];

    if (nullArtists.length === 0) {
        console.log("✅ No se encontraron artistas con tidal_id en NULL.");
        rl.close();
        return;
    }

    // Cargar decisiones existentes
    let decisions = { non_existent_on_tidal: [], manual_links: [] };
    if (fs.existsSync(DECISIONS_FILE)) {
        decisions = JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf-8'));
    }

    console.log(`📋 Se encontraron ${nullArtists.length} artistas por actualizar.\n`);

    for (const artist of nullArtists) {
        // 2. Buscar 5 ejemplos en el historial para dar contexto
        const examples = db.prepare(`
            SELECT DISTINCT track_name, album_name 
            FROM play_history 
            WHERE LOWER(artist_name) = LOWER(?)
            LIMIT 5
        `).all(artist.name) as any[];

        console.log("=".repeat(50));
        console.log(`👤 ARTISTA: "${artist.name}"`);
        console.log(`📂 ID LOCAL: ${artist.id}`);
        console.log(`🎵 EJEMPLOS EN HISTORIAL:`);
        
        if (examples.length > 0) {
            examples.forEach(ex => console.log(`   • ${ex.track_name} [${ex.album_name}]`));
        } else {
            console.log("   (No se encontraron canciones en play_history)");
        }
        console.log("-".repeat(50));

        const input = await ask(`Acción para "${artist.name}": [ID] | [x] No existe | [s] Saltar | [q] Salir: `);

        if (input.toLowerCase() === 'q') break;
        if (input.toLowerCase() === 's') {
            console.log(`⏭️  Saltando a ${artist.name}...\n`);
            continue;
        }

        if (input.toLowerCase() === 'x') {
            // Opción: No existe en Tidal
            decisions.non_existent_on_tidal.push({
                artist_name: artist.name,
                date: new Date().toISOString()
            });
            fs.writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2));
            console.log(`🚫 Marcado como inexistente y registrado en cleanup_decisions.\n`);
            continue;
        }

        if (input.trim().length > 0) {
            try {
                // Actualizar el registro en la DB
                db.prepare("UPDATE artists SET tidal_id = ? WHERE id = ?").run(input.trim(), artist.id);
                console.log(`✅ Actualizado en DB: ${artist.name} -> Tidal ID: ${input}\n`);
            } catch (error: any) {
                console.log(`❌ Error al actualizar en DB: ${error.message}\n`);
            }
        } else {
            console.log("⚠️ Entrada vacía, saltando...\n");
        }
    }

    console.log("🏁 Proceso de actualización terminado.");
    rl.close();
}

fixNullArtists();