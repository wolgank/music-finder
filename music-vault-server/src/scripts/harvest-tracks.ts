import db from '../db';
import { TidalClient } from "../lib/tidal/client";
import * as fs from 'fs';
import { randomUUID } from "crypto";
const Levenshtein = require('fast-levenshtein');
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cleanText(text: string): string {
    return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
}

function isFlexibleMatch(nameH: string, nameT: string): boolean {
    const h = cleanText(nameH);
    const t = cleanText(nameT);
    if (h === t || t.includes(h) || h.includes(t)) return true;
    const distance = Levenshtein.get(h, t);
    return distance <= Math.min(Math.floor(h.length / 5), 3);
}

async function harvestFromIndex() {
    const INDEX_FILE = 'library_index.json';
    if (!fs.existsSync(INDEX_FILE)) {
        console.error("🔴 Error: No se encontró library_index.json");
        return;
    }

    const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    
    // 1. Filtrar los que de verdad faltan y tienen un álbum local asignado
    const incomplete = index.filter((item: any) => 
        item.status === "INCOMPLETE" && 
        item.links.album_id && 
        item.links.album_id !== "NO EXISTE"
    );

    // 2. Agrupar por album_id
    const albumsToProcess = new Map<string, any[]>();
    incomplete.forEach((item: any) => {
        const aid = item.links.album_id;
        if (!albumsToProcess.has(aid)) albumsToProcess.set(aid, []);
        albumsToProcess.get(aid)!.push(item);
    });

    const totalAlbums = albumsToProcess.size;
    console.log(`🚀 Iniciando cosecha para ${totalAlbums} álbumes con canciones pendientes.`);

    let processedCount = 0;
    let consecutiveAlbumFailures = 0; // Circuit Breaker
    const MAX_CONSECUTIVE_FAILURES = 10;

    for (const [albumId, items] of albumsToProcess.entries()) {
        processedCount++;
        const albumDb = db.prepare("SELECT title, tidal_id FROM albums WHERE id = ?").get(albumId) as any;
        
        if (!albumDb || !albumDb.tidal_id) {
            console.log(`\n⚠️ Saltando álbum local ${albumId} (No tiene Tidal ID)`);
            continue;
        }

        const progress = ((processedCount / totalAlbums) * 100).toFixed(1);
        console.log(`\n[${progress}%] 💿 Procesando: ${albumDb.title} (${items.length} pendientes)`);

        try {
            // 3. Extraer tracks de Tidal (Paginado)
            let tidalTracks: any[] = [];
            let nextCursor: string | null = null;
            do {
                const params: any = { countryCode: "US", include: "items", "page[limit]": 50 };
                if (nextCursor) params["page[cursor]"] = nextCursor;
                const res = await tidal['api'].get(`/v2/albums/${albumDb.tidal_id}/relationships/items`, { params });
                
                const data = res.data.data || [];
                const included = res.data.included || [];
                const detailsMap = new Map(included.filter((i:any)=>i.type==="tracks").map((i:any)=>[i.id, i.attributes]));

                tidalTracks = tidalTracks.concat(data.filter((d:any)=>d.type==="tracks").map((d:any)=>({
                    id: d.id,
                    title: detailsMap.get(d.id)?.title,
                    isrc: detailsMap.get(d.id)?.isrc,
                    track_no: d.meta?.trackNumber?.toString(),
                    vol_no: d.meta?.volumeNumber?.toString()
                })));
                nextCursor = res.data.links?.meta?.nextCursor || null;
            } while (nextCursor);

            // 4. Mapeo y Persistencia con Fault Tolerance
            let matchesInThisAlbum = 0;
            db.transaction(() => {
                for (const t of tidalTracks) {
                    db.prepare(`
                        INSERT OR IGNORE INTO tracks (id, title, isrc, track_number, volume_number, tidal_id, album_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(randomUUID(), t.title, t.isrc, t.track_no, t.vol_no, t.id, albumId);

                    const finalTrack = db.prepare("SELECT id FROM tracks WHERE tidal_id = ?").get(t.id) as { id: string };

                    items.forEach(item => {
                        if (item.status === "INCOMPLETE" && isFlexibleMatch(item.history.track_name, t.title)) {
                            item.links.track_id = finalTrack.id;
                            item.status = "MAPPED";
                            matchesInThisAlbum++;
                        }
                    });
                }
            })();

            if (matchesInThisAlbum > 0) {
                consecutiveAlbumFailures = 0;
                process.stdout.write(`   ✅ ${matchesInThisAlbum} canciones mapeadas exitosamente.\n`);
            } else {
                consecutiveAlbumFailures++;
                console.log(`   ⚠️ No se encontró match para las canciones de este álbum (${consecutiveAlbumFailures}/${MAX_CONSECUTIVE_FAILURES})`);
            }

            // Guardar progreso atómico
            fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));

            if (consecutiveAlbumFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.error(`\n🚨 PARADA DE EMERGENCIA: ${MAX_CONSECUTIVE_FAILURES} álbumes seguidos sin encontrar canciones. Revisa la normalización.`);
                break;
            }

            await sleep(1000);

        } catch (e: any) {
            console.error(`   ❌ Error crítico en ${albumDb.title}:`, e.message);
            // Fault Tolerance: Continuamos con el siguiente álbum a pesar del error
            continue;
        }
    }

    console.log("\n\n🏁 Cosecha finalizada. Proporción de éxito guardada en library_index.json.");
}

harvestFromIndex();