//process-new-artists.ts
import db from '../db';
import * as fs from 'fs';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query: string): Promise<string> => new Promise((resolve) => rl.question(query, resolve));

async function processNewArtists() {
    const DECISIONS_FILE = 'cleanup_decisions.json';
    const MAPPINGS_FILE = 'music_mappings.json';

    if (!fs.existsSync(MAPPINGS_FILE)) {
        console.error("🔴 Error: No se encontró music_mappings.json");
        return;
    }

    // 1. Cargar datos y decisiones
    let decisions = JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf-8'));
    const mappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf-8'));

    // 2. Obtener artistas en DB para filtrar
    const dbArtists = new Set((db.prepare("SELECT name FROM artists").all() as any[]).map(a => a.name.toLowerCase()));
    const manualArtists = new Set(decisions.manual_links.map((m: any) => m.artist_name.toLowerCase()));
    const nonExistentArtists = new Set(decisions.non_existent_on_tidal.map((x: any) => x.artist_name.toLowerCase()));

    // 3. Agrupar canciones por artista y contar importancia
    const artistStats = new Map<string, { songs: any[], count: number }>();
    
    mappings.forEach((m: any) => {
        const name = m.history.artist_name;
        const lowName = name.toLowerCase();

        // Solo procesamos si no está en DB, ni en manual_links, ni en non_existent
        if (!dbArtists.has(lowName) && !manualArtists.has(lowName) && !nonExistentArtists.has(lowName)) {
            if (!artistStats.has(name)) artistStats.set(name, { songs: [], count: 0 });
            const stats = artistStats.get(name)!;
            stats.count++;
            if (stats.songs.length < 5) stats.songs.push(m);
        }
    });

    // 4. Ordenar por importancia (cantidad de canciones)
    const sortedArtists = Array.from(artistStats.entries())
        .sort((a, b) => b[1].count - a[1].count);

    console.log(`\n🚀 Se encontraron ${sortedArtists.length} artistas nuevos por clasificar.`);
    console.log(`Mostrando por orden de importancia (volumen en historial).\n`);

    for (const [name, data] of sortedArtists) {
        console.log(`\n=================================================`);
        console.log(`👤 ARTISTA: "${name.toUpperCase()}"`);
        console.log(`📈 Importancia: ${data.count} canciones en historial`);
        console.log(`🎵 Ejemplos:`);
        data.songs.forEach(s => console.log(`   • ${s.history.track_name} [${s.history.album_name}]`));
        console.log(`-------------------------------------------------`);

        console.log(`Opciones: [ID de Tidal] | [x] No existe en Tidal | [s] Saltar | [q] Salir`);
        const input = await ask(`Acción para ${name}: `);

        if (input.toLowerCase() === 'q') break;
        if (input.toLowerCase() === 's') continue;

        if (input.toLowerCase() === 'x') {
            decisions.non_existent_on_tidal.push({
                artist_name: name,
                date: new Date().toISOString()
            });
            console.log(`🚫 ${name} marcado como inexistente.`);
        } else if (input.length > 3) { // Asumimos que un ID es una cadena larga
            decisions.manual_links.push({
                artist_name: name,
                correct_tidal_id: input.trim(),
                status: "pending_download",
                notes: "Identificado por importancia en historial"
            });
            console.log(`📥 ${name} (ID: ${input}) agregado a manual_links.`);
        } else {
            console.log("⚠️ Entrada no válida, saltando...");
        }

        // Guardar progreso en cada paso
        fs.writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2));
    }

    console.log("\n✅ Proceso de clasificación terminado.");
    rl.close();
}

processNewArtists();