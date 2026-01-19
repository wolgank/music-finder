//music-vault-server/src/scripts/test_track_harvest.ts
import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

// Interfaces estrictas para el bloque 'included'
interface TidalTrackAttributes {
    title: string;
    duration: string; // Viene en formato ISO8601 (PT3M5S)
    isrc: string;
}

interface TidalTrackResource {
    id: string;
    type: string;
    attributes: TidalTrackAttributes;
}

interface TidalRelationshipItem {
    id: string;
    meta: {
        trackNumber: number;
        volumeNumber: number;
    };
    type: string;
}

interface TidalItemsResponse {
    data: TidalRelationshipItem[];
    included: TidalTrackResource[];
}

// Utilidad para convertir duraciones PT3M5S a milisegundos
function parseISO8601Duration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || "0");
    const minutes = parseInt(match[2] || "0");
    const seconds = parseInt(match[3] || "0");
    return ((hours * 3600) + (minutes * 60) + seconds) * 1000;
}

async function testTrackHarvest() {
    console.log("🧪 INICIANDO PRUEBA DE COSECHA QUIRÚRGICA...");

    try {
        console.log("🔍 [1/4] Buscando canción objetivo en el historial...");
        const query = `
            SELECT ph.id as history_id, ph.track_name, alb.id as local_album_id, alb.tidal_id as tidal_album_id, art.name as artist_name
            FROM play_history ph
            JOIN albums alb ON lower(ph.album_name) = lower(alb.title)
            JOIN artists art ON alb.artist_id = art.id AND lower(ph.artist_name) = lower(art.name)
            WHERE ph.track_id IS NULL
            LIMIT 1
        `;

        const target = db.prepare(query).get() as { 
            history_id: number, 
            track_name: string, 
            local_album_id: string, 
            tidal_album_id: string,
            artist_name: string 
        };

        if (!target) {
            console.error("❌ No hay canciones pendientes con álbum vinculado.");
            return;
        }

        console.log(`   🎯 Objetivo: "${target.track_name}"`);
        console.log(`   💿 Álbum Tidal ID: ${target.tidal_album_id}`);

        // PASO 2: Llamada corregida con 'relationships' e 'include'
        console.log(`📡 [2/4] Consultando: /v2/albums/${target.tidal_album_id}/relationships/items...`);
        
        const res = await tidal['api'].get<TidalItemsResponse>(
            `/v2/albums/${target.tidal_album_id}/relationships/items`, 
            { params: { countryCode: "US", include: "items" } }
        );

        const trackRelations = res.data.data;
        const trackDetails = res.data.included;

        console.log(`   ✅ Respuesta recibida. Encontradas ${trackDetails.length} canciones.`);

        // PASO 3: Matching entre historial e 'included'
        console.log("🧠 [3/4] Buscando coincidencia...");
        const cleanHistoryName = target.track_name.toLowerCase().trim();
        
        const matchedDetail = trackDetails.find(t => 
            t.attributes.title.toLowerCase().includes(cleanHistoryName) || 
            cleanHistoryName.includes(t.attributes.title.toLowerCase())
        );

        if (matchedDetail) {
            // Buscamos la meta-información (número de track) en el array 'data'
            const metaInfo = trackRelations.find(r => r.id === matchedDetail.id);
            const attr = matchedDetail.attributes;

            console.log(`   ✨ ¡Match!: "${attr.title}" (ISRC: ${attr.isrc})`);

            // PASO 4: Guardado
            console.log("💾 [4/4] Guardando en DB...");
            const trackUuid = randomUUID();

            db.transaction(() => {
                db.prepare(`
                    INSERT OR IGNORE INTO tracks (id, title, duration_ms, isrc, track_number, volume_number, tidal_id, album_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    trackUuid,
                    attr.title,
                    parseISO8601Duration(attr.duration),
                    attr.isrc,
                    metaInfo?.meta.trackNumber || 0,
                    metaInfo?.meta.volumeNumber || 1,
                    matchedDetail.id,
                    target.local_album_id
                );

                db.prepare("UPDATE play_history SET track_id = ? WHERE id = ?").run(trackUuid, target.history_id);
            })();
            
            console.log("✅ Canción registrada correctamente.");
        } else {
            console.log(`⚠️ No se encontró "${target.track_name}" en la lista del álbum.`);
        }

    } catch (error: any) {
        console.error("\n💥 ERROR EN EL PROCESO:");
        console.error(`   Status: ${error.response?.status}`);
        console.error(`   Detalle: ${JSON.stringify(error.response?.data || error.message)}`);
    }
}

testTrackHarvest();