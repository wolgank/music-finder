//interactive-cleanup.ts
import db from '../db';
import * as fs from 'fs';
import * as readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

interface ArtistInfo { id: string; name: string; tidal_id: string | null; }
interface DuplicateGroup { name: string; id_list: string; }
const ask = (query: string): Promise<string> => new Promise((resolve) => rl.question(query, resolve));

async function interactiveCleanup() {
    const DECISIONS_FILE = 'cleanup_decisions.json';
    let decisions = { discarded_tidal_ids: [] as string[], manual_links: [] as any[], non_existent_on_tidal: [] as any[] };
    
    if (fs.existsSync(DECISIONS_FILE)) {
        decisions = { ...decisions, ...JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf-8')) };
    }

    console.log("🤖 Iniciando fase de auto-limpieza basada en Manual Links...");

    // --- AUTO-POBLACIÓN DE DISCARDED_TIDAL_IDS ---
    for (const link of decisions.manual_links) {
        // Buscamos en la DB artistas con ese nombre pero con un tidal_id diferente al correcto
        const doppelgangers = db.prepare(`
            SELECT id, tidal_id FROM artists 
            WHERE LOWER(name) = LOWER(?) AND (tidal_id != ? OR tidal_id IS NULL)
        `).all(link.artist_name, link.correct_tidal_id) as ArtistInfo[];

        for (const dop of doppelgangers) {
            if (dop.tidal_id && !decisions.discarded_tidal_ids.includes(String(dop.tidal_id))) {
                console.log(`📌 Auto-descartando Doppelgänger de ${link.artist_name}: Tidal ID ${dop.tidal_id}`);
                decisions.discarded_tidal_ids.push(String(dop.tidal_id));
            }

            // Opcional: Borrado automático para limpiar la DB de una vez
            db.transaction(() => {
                db.prepare(`DELETE FROM tracks WHERE album_id IN (SELECT id FROM albums WHERE artist_id = ?)`).run(dop.id);
                db.prepare(`DELETE FROM albums WHERE artist_id = ?`).run(dop.id);
                db.prepare(`DELETE FROM artists WHERE id = ?`).run(dop.id);
            })();
        }
    }
    // Guardamos los descartes automáticos
    fs.writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2));

    const mappings = JSON.parse(fs.readFileSync('music_mappings.json', 'utf-8'));

    // Obtenemos los grupos duplicados que quedan
    const duplicateGroups = db.prepare(`
        SELECT name, GROUP_CONCAT(id) as id_list 
        FROM artists 
        GROUP BY LOWER(name) 
        HAVING COUNT(*) > 1
    `).all() as DuplicateGroup[];

    // Filtrar grupos que ya están resueltos en manual_links o non_existent
    const pendingGroups = duplicateGroups.filter(group => {
        const inManual = decisions.manual_links.some(m => m.artist_name.toLowerCase() === group.name.toLowerCase());
        const inNonExistent = decisions.non_existent_on_tidal.some(x => x.artist_name.toLowerCase() === group.name.toLowerCase());
        return !inManual && !inNonExistent;
    });

    if (pendingGroups.length === 0) {
        console.log("✅ No quedan duplicados pendientes de procesar. ¡Todo limpio o clasificado!");
        rl.close();
        return;
    }

    for (const group of pendingGroups) {
        const ids = group.id_list.split(',');
        console.log(`\n=================================================`);
        console.log(`🔍 ARTISTA DUPLICADO: "${group.name.toUpperCase()}"`);
        console.log(`=================================================`);

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const artist = db.prepare('SELECT id, name, tidal_id FROM artists WHERE id = ?').get(id) as ArtistInfo;
            const isDiscarded = decisions.discarded_tidal_ids.includes(String(artist.tidal_id));

            const historyExamples = mappings.filter((m: any) => 
                String(m.links.artist_id) === id || 
                (m.history.artist_name.toLowerCase() === group.name.toLowerCase() && !m.links.artist_id)
            );

            const albums = db.prepare('SELECT COUNT(*) as count FROM albums WHERE artist_id = ?').get(id) as any;
            const tracks = db.prepare('SELECT COUNT(*) as count FROM tracks WHERE album_id IN (SELECT id FROM albums WHERE artist_id = ?)').get(id) as any;

            console.log(`${i + 1}) DB_ID: ${id}`);
            console.log(`   🆔 TIDAL_ID: ${artist.tidal_id || 'N/A'} ${isDiscarded ? '❌ (PARA DESCARTAR)' : ''}`);
            console.log(`   📦 Contenido: ${albums.count} álbumes, ${tracks.count} canciones`);
            console.log(`   🎵 Historial: ${historyExamples.length} matches.`);
        }

        console.log(`\nACCIONES: [1-${ids.length}] Seleccionar CORRECTO | [n] Manual | [x] NO EN TIDAL | [d] Descartar | [s] Saltar | [q] Salir`);
        
        const choice = await ask(`\nSelección para ${group.name}: `);
        if (choice === 'q') break;
        if (choice === 's') continue;

        if (choice === 'x') {
            decisions.non_existent_on_tidal.push({ artist_name: group.name, date: new Date().toISOString() });
        } else if (choice === 'n') {
            const correctTidal = await ask("ID de Tidal correcto: ");
            decisions.manual_links.push({ artist_name: group.name, correct_tidal_id: correctTidal, status: "pending_download" });
        } else if (choice === 'd') {
            const tid = await ask("TIDAL_ID a descartar: ");
            if (!decisions.discarded_tidal_ids.includes(tid)) decisions.discarded_tidal_ids.push(tid);
            // ... (Lógica de borrado manual ya existente)
        } else {
            const idx = parseInt(choice) - 1;
            if (idx >= 0 && idx < ids.length) {
                const keepId = ids[idx];
                const toDelete = ids.filter(id => id !== keepId);
                db.transaction(() => {
                    for (const targetId of toDelete) {
                        const art = db.prepare('SELECT tidal_id FROM artists WHERE id = ?').get(targetId) as any;
                        if (art?.tidal_id) decisions.discarded_tidal_ids.push(String(art.tidal_id));
                        db.prepare(`DELETE FROM tracks WHERE album_id IN (SELECT id FROM albums WHERE artist_id = ?)`).run(targetId);
                        db.prepare(`DELETE FROM albums WHERE artist_id = ?`).run(targetId);
                        db.prepare(`DELETE FROM artists WHERE id = ?`).run(targetId);
                    }
                })();
                console.log("✅ Limpieza completada.");
            }
        }
        fs.writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2));
    }
    rl.close();
}

interactiveCleanup();