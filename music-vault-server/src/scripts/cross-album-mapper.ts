import db from '../db';
import * as fs from 'fs';
const Levenshtein = require('fast-levenshtein');

function cleanText(text: string): string {
    return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * Umbral de confianza flexible:
 * Se considera coincidencia si la distancia es muy baja respecto al largo total.
 */
function isTrustedMatch(nameH: string, nameT: string): boolean {
    const h = cleanText(nameH);
    const t = cleanText(nameT);
    if (h === t || t.includes(h) || h.includes(t)) return true;

    const distance = Levenshtein.get(h, t);
    // Umbral del ~90%: permitimos 1 error cada 10 caracteres
    const threshold = Math.max(1, Math.floor(h.length * 0.1));
    return distance <= threshold;
}

async function crossAlbumMapping() {
    const INDEX_FILE = 'library_index.json';
    if (!fs.existsSync(INDEX_FILE)) return;

    const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    const incomplete = index.filter((i: any) => i.status === "INCOMPLETE");

    console.log(`🔍 Buscando coincidencias globales para ${incomplete.length} tracks pendientes...`);

    // Agrupamos por artista para optimizar las consultas a la DB
    const artistGroups = new Map<string, any[]>();
    incomplete.forEach(item => {
        const art = item.history.artist_name;
        if (!artistGroups.has(art)) artistGroups.set(art, []);
        artistGroups.get(art)!.push(item);
    });

    let fixedCount = 0;

    for (const [artistName, items] of artistGroups.entries()) {
        // Obtenemos TODAS las canciones de este artista en la DB, sin importar el álbum
        const dbTracks = db.prepare(`
            SELECT t.id as track_id, t.title as track_title, t.album_id, a.title as album_title, a.artist_id
            FROM tracks t
            JOIN albums a ON t.album_id = a.id
            JOIN artists art ON a.artist_id = art.id
            WHERE LOWER(art.name) = LOWER(?)
        `).all(artistName) as any[];

        if (dbTracks.length === 0) continue;

        for (const item of items) {
            const match = dbTracks.find(dbT => isTrustedMatch(item.history.track_name, dbT.track_title));

            if (match) {
                // Actualizamos los links con la ubicación real encontrada en la DB
                item.links.track_id = match.track_id;
                item.links.album_id = match.album_id;
                item.links.artist_id = match.artist_id;
                item.status = "MAPPED";
                item.match_confidence = 0.90; // Marcamos la confianza del 90%
                fixedCount++;
                
                process.stdout.write(`   ✅ Encontrada: ${artistName} - ${item.history.track_name} (en álbum: ${match.album_title})\n`);
            }
        }
    }

    if (fixedCount > 0) {
        fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
        console.log(`\n🎉 Se lograron reubicar ${fixedCount} canciones exitosamente.`);
    } else {
        console.log("\n      No se encontraron coincidencias adicionales en otros álbumes.");
    }
}

crossAlbumMapping();