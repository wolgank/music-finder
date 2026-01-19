import db from '../db';
import * as fs from 'fs';

async function analyzeLibrary() {
    const INDEX_FILE = 'library_index.json';
    const REPORT_FILE = 'missing_tracks_report.txt';

    if (!fs.existsSync(INDEX_FILE)) {
        console.error("🔴 Error: No se encontró library_index.json.");
        return;
    }

    console.log("📊 ANALIZANDO PRIORIDADES DE LA BIBLIOTECA...");
    const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));

    // 1. Obtener conteo de escuchas (Play Count) por artista desde la DB
    const playCounts = db.prepare(`
        SELECT artist_name, COUNT(*) as count 
        FROM play_history 
        GROUP BY artist_name
    `).all() as { artist_name: string, count: number }[];

    const artistPlayMap = new Map(playCounts.map(pc => [pc.artist_name.toLowerCase(), pc.count]));

    const total = index.length;
    let mapped = 0;
    let incomplete = 0;
    let discarded = 0;
    
    // Estructura para el reporte
    const missingData: Record<string, { albums: Record<string, string[]>, totalMissing: number, plays: number }> = {};

    index.forEach((item: any) => {
        if (item.status === "MAPPED") {
            mapped++;
        } else if (item.status === "INCOMPLETE") {
            incomplete++;
            const art = item.history.artist_name;
            const alb = item.history.album_name;
            const trk = item.history.track_name;

            if (!missingData[art]) {
                missingData[art] = { 
                    albums: {}, 
                    totalMissing: 0, 
                    plays: artistPlayMap.get(art.toLowerCase()) || 0 
                };
            }
            if (!missingData[art].albums[alb]) missingData[art].albums[alb] = [];
            
            missingData[art].albums[alb].push(trk);
            missingData[art].totalMissing++;
        } else if (item.status === "DISCARDED") {
            discarded++;
        }
    });

    // 2. Ordenar Artistas: 1° por Escuchas (desc), 2° por Faltantes (desc)
    const sortedArtists = Object.keys(missingData).sort((a, b) => {
        const diffPlays = missingData[b].plays - missingData[a].plays;
        if (diffPlays !== 0) return diffPlays;
        return missingData[b].totalMissing - missingData[a].totalMissing;
    });

    // --- GENERAR ARCHIVO DE TEXTO ---
    let fileContent = `REPORTE DE FALTANTES POR PRIORIDAD DE ESCUCHA\n`;
    fileContent += `Generado el: ${new Date().toLocaleString()}\n`;
    fileContent += `Criterio: 1° Popularidad personal | 2° Cantidad de huecos\n`;
    fileContent += "=".repeat(70) + "\n\n";

    sortedArtists.forEach(artist => {
        const data = missingData[artist];
        fileContent += `👤 ARTISTA: ${artist} (${data.plays} escuchas totales | ${data.totalMissing} tracks faltantes)\n`;
        
        const sortedAlbums = Object.keys(data.albums).sort();
        sortedAlbums.forEach(album => {
            fileContent += `   💿 ÁLBUM: ${album}\n`;
            data.albums[album].sort().forEach(track => {
                fileContent += `      - ${track}\n`;
            });
        });
        fileContent += `\n` + "-".repeat(50) + `\n`;
    });

    fs.writeFileSync(REPORT_FILE, fileContent);

    // --- RESUMEN POR CONSOLA ---
    console.log("\n" + "=".repeat(50));
    console.log("📈 RESUMEN DE INTEGRIDAD");
    console.log("=".repeat(50));
    console.log(`🟢 Mapeados:      ${mapped} (${((mapped / total) * 100).toFixed(1)}%)`);
    console.log(`🚩 Pendientes:    ${incomplete} (${((incomplete / total) * 100).toFixed(1)}%)`);
    console.log(`⚪ Descartados:   ${discarded}`);
    console.log("=".repeat(50));
    console.log(`📝 Reporte priorizado en: ${REPORT_FILE}`);
}

analyzeLibrary();