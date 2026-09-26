import db from '../db';
import * as fs from 'fs';

async function checkGaps() {
    console.log("📊 INICIANDO AUDITORÍA POR NOMBRE EXACTO...");

    // 1. Cargar lo que REALMENTE hay en la DB (Nombres exactos)
    const dbArtists = db.prepare("SELECT name FROM artists").all() as { name: string }[];
    const dbAlbums = db.prepare("SELECT title FROM albums").all() as { title: string }[];
    
    // Usamos un Set para búsqueda instantánea (case-insensitive para mayor seguridad)
    const dbArtistsSet = new Set(dbArtists.map(a => a.name.toLowerCase().trim()));
    const dbAlbumsSet = new Set(dbAlbums.map(a => a.title.toLowerCase().trim()));

    // 2. Cargar Decisiones para no reportar lo que ya descartaste
    const decisions = fs.existsSync('cleanup_decisions.json') 
        ? JSON.parse(fs.readFileSync('cleanup_decisions.json', 'utf-8'))
        : { manual_links: [], non_existent_on_tidal: [] };

    const excludedArtists = new Set([
        ...decisions.manual_links.map((m: any) => m.artist_name.toLowerCase().trim()),
        ...decisions.non_existent_on_tidal.map((x: any) => x.artist_name.toLowerCase().trim())
    ]);

    // 3. Analizar el Historial
    const history = db.prepare(`
        SELECT DISTINCT artist_name, album_name 
        FROM play_history 
        WHERE artist_name IS NOT NULL AND album_name IS NOT NULL
    `).all() as { artist_name: string, album_name: string }[];

    const missingArtists = new Set<string>();
    const missingAlbums = new Set<string>();

    for (const entry of history) {
        const artistLower = entry.artist_name.toLowerCase().trim();
        const albumLower = entry.album_name.toLowerCase().trim();

        // Si ya lo tenemos identificado en decisiones, saltar
        if (excludedArtists.has(artistLower)) continue;

        // VALIDACIÓN DE ARTISTA: ¿Está el nombre exacto en la tabla artists?
        if (!dbArtistsSet.has(artistLower)) {
            missingArtists.add(entry.artist_name);
        }

        // VALIDACIÓN DE ÁLBUM: ¿Está el nombre exacto en la tabla albums?
        if (!dbAlbumsSet.has(albumLower)) {
            missingAlbums.add(`${entry.artist_name} - ${entry.album_name}`);
        }
    }

    // --- GENERAR REPORTE ---
    let report = `REPORTE DE FALTANTES REALES (BÚSQUEDA EXACTA)\n`;
    report += `Generado el: ${new Date().toLocaleString()}\n`;
    report += `------------------------------------------------------------\n\n`;

    report += `1. ARTISTAS QUE NO TIENEN REGISTRO EN LA TABLA 'ARTISTS' (${missingArtists.size})\n`;
    Array.from(missingArtists).sort().forEach(a => report += `- ${a}\n`);

    report += `\n2. ÁLBUMES QUE NO TIENEN REGISTRO EN LA TABLA 'ALBUMS' (${missingAlbums.size})\n`;
    Array.from(missingAlbums).sort().forEach(alb => report += `- ${alb}\n`);

    fs.writeFileSync('audit_report_detailed.txt', report);

    console.log("\n" + "=".repeat(50));
    console.log(`✅ Auditoría finalizada.`);
    console.log(`👤 Artistas faltantes: ${missingArtists.size}`);
    console.log(`💿 Álbumes faltantes:  ${missingAlbums.size}`);
    console.log("=".repeat(50));
    console.log(`📝 Revisa 'audit_report_detailed.txt' para ver la lista real.`);
}

checkGaps();