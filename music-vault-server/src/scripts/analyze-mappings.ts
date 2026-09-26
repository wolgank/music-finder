//analyze-mappings.ts
import * as fs from 'fs';

interface Mapping {
    history: {
        track_name: string;
        artist_name: string;
        album_name: string;
    };
    links: {
        track_id: number | null;
        album_id: number | null;
        artist_id: number | null;
    };
    match_confidence: number;
    search_phase: 'fast' | 'deep' | 'none';
}

async function analyzeMappings() {
    console.log("📊 Analizando resultados de music_mappings.json...");

    if (!fs.existsSync('music_mappings.json')) {
        console.error("🔴 Error: No se encontró el archivo music_mappings.json. Ejecuta primero el script de generación.");
        return;
    }

    const data: Mapping[] = JSON.parse(fs.readFileSync('music_mappings.json', 'utf-8'));

    // Estructuras para estadísticas
    const artists = new Map<string, { total: number, matches: number }>();
    const albums = new Map<string, { total: number, matches: number }>();
    let totalTracks = data.length;
    let matchedTracks = 0;

    data.forEach(m => {
        const artistName = m.history.artist_name;
        const albumName = `${m.history.artist_name} - ${m.history.album_name}`; // Key única para álbumes
        const isMatched = m.links.track_id !== null;

        if (isMatched) matchedTracks++;

        // Tracking de Artistas
        if (!artists.has(artistName)) artists.set(artistName, { total: 0, matches: 0 });
        const artStat = artists.get(artistName)!;
        artStat.total++;
        if (isMatched) artStat.matches++;

        // Tracking de Álbumes
        if (!albums.has(albumName)) albums.set(albumName, { total: 0, matches: 0 });
        const albStat = albums.get(albumName)!;
        albStat.total++;
        if (isMatched) albStat.matches++;
    });

    // Cálculos
    const artistsWithSomeMissing = Array.from(artists.values()).filter(a => a.matches < a.total).length;
    const artistsWithZeroMatches = Array.from(artists.values()).filter(a => a.matches === 0).length;

    const albumsWithSomeMissing = Array.from(albums.values()).filter(a => a.matches < a.total).length;
    const albumsWithZeroMatches = Array.from(albums.values()).filter(a => a.matches === 0).length;

    const missingTracks = totalTracks - matchedTracks;

    // Reporte
    console.log("\n" + "=".repeat(40));
    console.log("📈 ESTADÍSTICAS DE MATCHING");
    console.log("=".repeat(40));

    console.log(`\n🎵 TRACKS (CANCIONES):`);
    console.log(`   Total analizadas:      ${totalTracks}`);
    console.log(`   Coincidencias (Match): ${matchedTracks} (${((matchedTracks/totalTracks)*100).toFixed(1)}%)`);
    console.log(`   Sin coincidencia:      ${missingTracks}`);

    console.log(`\n👤 ARTISTAS:`);
    console.log(`   Con al menos una canción faltante:  ${artistsWithSomeMissing}`);
    console.log(`   Sin NINGUNA canción encontrada:     ${artistsWithZeroMatches} ⚠️`);

    console.log(`\n💿 ÁLBUMES:`);
    console.log(`   Con al menos una canción faltante:  ${albumsWithSomeMissing}`);
    console.log(`   Sin NINGUNA canción encontrada:     ${albumsWithZeroMatches} ⚠️`);
    
    console.log("\n" + "=".repeat(40));
}

analyzeMappings().catch(console.error);