// music-vault-server/src/scripts/check-missing-songs.ts
import db from '../db';
import * as fs from 'fs';
import { join } from 'path';
import { REPORTS_DIR } from '../paths';

async function runComparison(): Promise<void> {
    try {
        // 1. Cargar Decisiones
        const decisions = fs.existsSync('cleanup_decisions.json') 
            ? JSON.parse(fs.readFileSync('cleanup_decisions.json', 'utf-8'))
            : { manual_links: [], non_existent_on_tidal: [] };

        const nonExistentArtistsSet = new Set(decisions.non_existent_on_tidal.map((x: any) => x.artist_name.toLowerCase()));
        const manualArtistsSet = new Set(decisions.manual_links.map((m: any) => m.artist_name.toLowerCase()));

        // 2. Cargar Datos de la DB
        const dbArtists = db.prepare("SELECT id, name FROM artists").all() as { id: string, name: string }[];
        const dbArtistsSet = new Set(dbArtists.map(a => a.name.toLowerCase()));
        
        // Mapeo rápido de Nombre -> ID para verificar álbumes
        const artistNameToId = new Map(dbArtists.map(a => [a.name.toLowerCase(), a.id]));

        // 3. Cargar Mappings
        if (!fs.existsSync('music_mappings.json')) {
            console.error("🔴 Error: No se encontró music_mappings.json.");
            return;
        }
        const mappings = JSON.parse(fs.readFileSync('music_mappings.json', 'utf-8'));

        // --- FILTRADO Y ESTADÍSTICAS ---
        const totalUniqueTracks = mappings.length;
        const missingTracksRows = mappings.filter((m: any) => m.links.track_id === null);
        
        let tracksMissingBecauseArtistNotFoundOnTidal = 0;
        const realMissingSongs: any[] = [];
        const missingArtistsSet = new Set<string>();
        const missingAlbumsSet = new Set<string>();

        // Cache local para no saturar la DB con la misma consulta de álbum repetida
        const albumExistCache = new Map<string, boolean>();

        for (const m of missingTracksRows) {
            const lowArtist = m.history.artist_name.toLowerCase();
            const lowAlbum = m.history.album_name.toLowerCase();
            
            if (nonExistentArtistsSet.has(lowArtist)) {
                tracksMissingBecauseArtistNotFoundOnTidal++;
                continue;
            }

            realMissingSongs.push(m);
            missingArtistsSet.add(m.history.artist_name);

            // --- LÓGICA DE ÁLBUM MEJORADA ---
            const artistId = artistNameToId.get(lowArtist);
            const cacheKey = `${artistId}|${lowAlbum}`;

            if (artistId) {
                if (!albumExistCache.has(cacheKey)) {
                    // Verificamos si existe el álbum para este artista específico
                    const albumInDb = db.prepare("SELECT id FROM albums WHERE artist_id = ? AND LOWER(title) = ?").get(artistId, lowAlbum);
                    albumExistCache.set(cacheKey, !!albumInDb);
                }

                // Solo se agrega a "Álbumes faltantes" si NO existe en la DB
                if (!albumExistCache.get(cacheKey)) {
                    missingAlbumsSet.add(`${m.history.artist_name}-|-${m.history.album_name}`);
                }
            } else {
                // Si el artista ni siquiera está en DB, el álbum por defecto es faltante
                missingAlbumsSet.add(`${m.history.artist_name}-|-${m.history.album_name}`);
            }
        }

        const realNewArtists = Array.from(missingArtistsSet).filter(a => 
            !dbArtistsSet.has(a.toLowerCase()) && 
            !manualArtistsSet.has(a.toLowerCase())
        ).sort();

        const existingArtistsWithMissingSongs = Array.from(missingArtistsSet).filter(a => 
            dbArtistsSet.has(a.toLowerCase())
        ).sort();

        // --- SALIDA POR TERMINAL ---
        console.log("\n" + "=".repeat(50));
        console.log("📊 RESUMEN DE ESTADO DE LA BIBLIOTECA");
        console.log("=".repeat(50));
        console.log(`\n🎵 CANCIONES (TRACKS):`);
        console.log(`   Total únicas: ${totalUniqueTracks} | Faltantes Reales: ${realMissingSongs.length}`);
        console.log(`\n👤 ARTISTAS:`);
        console.log(`   Realmente Nuevos: ${realNewArtists.length} ⭐ | Existentes con faltantes: ${existingArtistsWithMissingSongs.length} 👤`);
        console.log(`\n💿 ÁLBUMES:`);
        console.log(`   Faltantes Reales (No están en DB): ${missingAlbumsSet.size} 💿`);
        console.log("\n" + "=".repeat(50));

        // --- GENERACIÓN DEL REPORTE DETALLADO ---
        let reportContent = `REPORTE DE MÚSICA FALTANTE\n`;
        reportContent += `Generado: ${new Date().toLocaleString()}\n`;
        reportContent += `${"=".repeat(60)}\n\n`;

        reportContent += `1. ⭐ ARTISTAS REALMENTE NUEVOS\n`;
        reportContent += `------------------------------------------------------------\n`;
        realNewArtists.length > 0 ? realNewArtists.forEach(a => reportContent += `[NEW] ${a}\n`) : reportContent += `No hay artistas nuevos.\n`;

        reportContent += `\n2. 👤 ARTISTAS EN DB CON CANCIONES FALTANTES\n`;
        reportContent += `------------------------------------------------------------\n`;
        existingArtistsWithMissingSongs.length > 0 ? existingArtistsWithMissingSongs.forEach(a => reportContent += `[DB] ${a}\n`) : reportContent += `No hay artistas existentes con pendientes.\n`;

        reportContent += `\n3. 💿 ÁLBUMES QUE FALTAN REGISTRAR (No existen en la tabla 'albums')\n`;
        reportContent += `------------------------------------------------------------\n`;
        const sortedAlbums = Array.from(missingAlbumsSet).sort((a, b) => a.localeCompare(b));
        sortedAlbums.length > 0 ? sortedAlbums.forEach(item => {
            const [artist, album] = item.split("-|-");
            reportContent += `[ALBUM] ${artist} - ${album}\n`;
        }) : reportContent += `Todos los álbumes de estas canciones ya existen en la DB.\n`;

        reportContent += `\n4. 🎵 LISTADO DETALLADO DE CANCIONES FALTANTES\n`;
        reportContent += `------------------------------------------------------------\n`;
        realMissingSongs.sort((a,b) => a.history.artist_name.localeCompare(b.history.artist_name)).forEach(s => {
            reportContent += `[ ] ${s.history.artist_name} - ${s.history.album_name} - ${s.history.track_name}\n`;
        });

        const reportPath = join(REPORTS_DIR, 'missing_songs_report.txt');
        fs.writeFileSync(reportPath, reportContent);
        console.log(`✅ Reporte actualizado: ${reportPath}`);

    } catch (error) {
        console.error("\n🔴 Error crítico:", (error as Error).message);
    }
}

runComparison();