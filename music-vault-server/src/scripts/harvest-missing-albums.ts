import db from '../db';
import { TidalClient } from "../lib/tidal/client";
import * as fs from 'fs';
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const Levenshtein = require('fast-levenshtein');

function cleanText(text: string): string {
    return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * Compara dos nombres de álbumes de forma flexible
 */
function isFlexibleMatch(nameH: string, nameT: string): boolean {
    const h = cleanText(nameH);
    const t = cleanText(nameT);

    if (h === t) return true;
    if (t.includes(h) || h.includes(t)) return true;

    const distance = Levenshtein.get(h, t);
    const threshold = Math.min(Math.floor(h.length / 5), 3);
    
    return distance <= threshold;
}

async function runHarvest() {
    console.log("🔍 ESCANEANDO BIBLIOTECA PARA DETECTAR ÁLBUMES FALTANTES...");

    const decisions = JSON.parse(fs.readFileSync('cleanup_decisions.json', 'utf-8'));
    const nonExistentArtistsSet = new Set(decisions.non_existent_on_tidal.map((x: any) => x.artist_name.toLowerCase()));

    const dbArtists = db.prepare("SELECT id, name, tidal_id FROM artists WHERE tidal_id IS NOT NULL").all() as any[];
    const artistNameToId = new Map(dbArtists.map(a => [a.name.toLowerCase(), { id: a.id, tidal_id: a.tidal_id }]));

    const mappings = JSON.parse(fs.readFileSync('music_mappings.json', 'utf-8'));
    const missingTracksRows = mappings.filter((m: any) => m.links.track_id === null);

    const targetArtistsMap = new Map<string, Set<string>>(); 
    const missingInDbArtists = new Set<string>();

    for (const m of missingTracksRows) {
        const lowArtist = m.history.artist_name.toLowerCase();
        const lowAlbum = m.history.album_name.toLowerCase();

        if (nonExistentArtistsSet.has(lowArtist)) continue;

        const dbArt = artistNameToId.get(lowArtist);
        if (!dbArt) {
            missingInDbArtists.add(m.history.artist_name);
            continue;
        }

        const albumInDb = db.prepare("SELECT id FROM albums WHERE artist_id = ? AND LOWER(title) = ?").get(dbArt.id, lowAlbum);
        
        if (!albumInDb) {
            if (!targetArtistsMap.has(m.history.artist_name)) {
                targetArtistsMap.set(m.history.artist_name, new Set());
            }
            targetArtistsMap.get(m.history.artist_name)!.add(m.history.album_name);
        }
    }

    const totalMissingAlbums = Array.from(targetArtistsMap.values()).reduce((acc, set) => acc + set.size, 0);
    console.log("\n" + "=".repeat(50));
    console.log("📊 RESUMEN DE COSECHA PENDIENTE");
    console.log("=".repeat(50));
    console.log(`👤 Artistas con álbumes faltantes: ${targetArtistsMap.size}`);
    console.log(`💿 Total de álbumes por buscar:    ${totalMissingAlbums}`);
    
    if (missingInDbArtists.size > 0) {
        console.log(`⚠️  Artistas no registrados en DB:   ${missingInDbArtists.size}`);
    }
    console.log("=".repeat(50));
    console.log("\n🚀 Iniciando cosecha automática...");

    let consecutiveMatchFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 10;

    for (const [artistName, missingAlbums] of targetArtistsMap.entries()) {
        const dbInfo = artistNameToId.get(artistName.toLowerCase())!;
        console.log(`\n👤 Procesando Artista: ${artistName} (Tidal ID: ${dbInfo.tidal_id})`);
        
        let foundAnyInThisArtist = false;
        let nextCursor: string | null = null;
        let totalArtistProcessed = 0;

        try {
            do {
                const params: any = { countryCode: "US", include: "albums", "page[limit]": 20 };
                if (nextCursor) params["page[cursor]"] = nextCursor;

                let response = await tidal['api'].get(`/v2/artists/${dbInfo.tidal_id}/relationships/albums`, { params });
                const included = response.data.included || [];
                nextCursor = response.data.links?.meta?.nextCursor || null;

                db.transaction(() => {
                    for (const alb of included) {
                        const tidalTitle = alb.attributes.title;
                        
                        db.prepare(`
                            INSERT OR IGNORE INTO albums (id, title, artist_id, tidal_id, image_url, title_clean)
                            VALUES (?, ?, ?, ?, NULL, ?)
                        `).run(randomUUID(), tidalTitle, dbInfo.id, alb.id, cleanText(tidalTitle));

                        const isFound = Array.from(missingAlbums).some(target => 
                            isFlexibleMatch(target, tidalTitle)
                        );

                        if (isFound) foundAnyInThisArtist = true;
                        totalArtistProcessed++;
                    }
                })();

                process.stdout.write(`   📦 Pág: +${included.length} (Total: ${totalArtistProcessed})${nextCursor ? ' ⏭️' : ' 🏁'}\r`);
                await sleep(1000);

            } while (nextCursor);

            if (foundAnyInThisArtist) {
                consecutiveMatchFailures = 0;
                console.log(`\n   ✅ Coincidencia flexible encontrada.`);
            } else {
                consecutiveMatchFailures++;
                console.log(`\n   ⚠️ Sin coincidencia (${consecutiveMatchFailures}/${MAX_CONSECUTIVE_FAILURES})`);
                console.log(`   🔎 Buscaba: ${Array.from(missingAlbums).join(", ")}`);
            }

            if (consecutiveMatchFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.log("\n🚨 PARADA DE EMERGENCIA: Demasiados fallos consecutivos.");
                break;
            }
        } catch (error: any) {
            console.error(`\n   🔴 Error con ${artistName}:`, error.message);
        }
    }
    console.log("\n🏁 Cosecha terminada.");
}

runHarvest();