//generate-mappings.ts
import db from '../db';
import * as fs from 'fs';

interface SongRow {
    track_name: string;
    artist_name: string;
    album_name: string;
}

interface MasterRow {
    track_id: number;
    track_title: string;
    album_id: number;
    album_title: string;
    artist_id: number;
    artist_name: string;
}

interface Mapping {
    history: SongRow;
    links: {
        track_id: number | null;
        album_id: number | null;
        artist_id: number | null;
    };
    match_confidence: number;
    search_phase: 'fast' | 'deep' | 'none';
}

var levenshtein = require('fast-levenshtein');

function normalize(text: string): string {
    return (text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, "")
        .trim();
}

function getSimilarityScore(str1: string, str2: string): number {
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0;

    const maxLen = Math.max(s1.length, s2.length);
    const dist = levenshtein.get(s1, s2);
    return 1 - dist / maxLen;
}

function findBestMatch(history: SongRow, dataset: MasterRow[]): { match: MasterRow | null, score: number } {
    let bestMatch: MasterRow | null = null;
    let highestScore = 0;

    for (const m of dataset) {
        const sArtist = getSimilarityScore(history.artist_name, m.artist_name);
        const sTrack = getSimilarityScore(history.track_name, m.track_title);
        
        const avgScore = (sArtist + sTrack) / 2;

        if (avgScore > highestScore) {
            highestScore = avgScore;
            bestMatch = m;
        }
        if (highestScore === 1.0) break;
    }

    return { match: bestMatch, score: highestScore };
}

async function generateMappings(): Promise<void> {
    console.time("⏱️ Proceso finalizado en");

    try {
        console.log("🚀 Cargando registros únicos de play_history...");

        // SELECT DISTINCT para evitar procesar repetidos
        const historyRows = db.prepare(`
            SELECT DISTINCT track_name, artist_name, album_name 
            FROM play_history 
            WHERE artist_name IS NOT NULL AND album_name IS NOT NULL
        `).all() as SongRow[];

        const masterRows = db.prepare(`
            SELECT 
                t.id as track_id, t.title as track_title,
                al.id as album_id, al.title as album_title,
                ar.id as artist_id, ar.name as artist_name
            FROM tracks t
            INNER JOIN albums al ON t.album_id = al.id
            INNER JOIN artists ar ON al.artist_id = ar.id
        `).all() as MasterRow[];

        // Agrupación por inicial para Fase 1
        const masterMap = new Map<string, MasterRow[]>();
        for (const row of masterRows) {
            const firstChar = normalize(row.artist_name).charAt(0);
            if (!masterMap.has(firstChar)) masterMap.set(firstChar, []);
            masterMap.get(firstChar)?.push(row);
        }

        const finalMappings: Mapping[] = [];
        const total = historyRows.length;

        console.log(`🔍 Analizando ${total} combinaciones únicas...`);

        for (let i = 0; i < total; i++) {
            const h = historyRows[i];
            const firstChar = normalize(h.artist_name).charAt(0);
            
            // FASE 1: Búsqueda rápida
            const fastDataset = masterMap.get(firstChar) || [];
            let result = findBestMatch(h, fastDataset);
            let phase: 'fast' | 'deep' | 'none' = 'fast';

            // FASE 2: Búsqueda profunda (si no llega al 90% de confianza)
            if (result.score < 0.9) {
                const deepResult = findBestMatch(h, masterRows);
                if (deepResult.score > result.score) {
                    result = deepResult;
                    phase = 'deep';
                }
            }

            const hasGoodMatch = result.match && result.score >= 0.9;
            if (!hasGoodMatch) phase = 'none';

            finalMappings.push({
                history: h,
                links: {
                    track_id: hasGoodMatch ? result.match!.track_id : null,
                    album_id: hasGoodMatch ? result.match!.album_id : null,
                    artist_id: hasGoodMatch ? result.match!.artist_id : null
                },
                match_confidence: Number(result.score.toFixed(4)),
                search_phase: phase
            });

            if ((i + 1) % 50 === 0 || i + 1 === total) {
                process.stdout.write(`\rProgreso: ${(((i + 1) / total) * 100).toFixed(1)}%`);
            }
        }

        console.log("\n💾 Guardando music_mappings.json...");
        fs.writeFileSync('music_mappings.json', JSON.stringify(finalMappings, null, 2));
        
        console.log(`✅ ¡Hecho! Se procesaron ${total} canciones únicas.`);

    } catch (error) {
        console.error("\n🔴 Error:", (error as Error).message);
    } finally {
        console.timeEnd("⏱️ Proceso finalizado en");
    }
}

generateMappings();