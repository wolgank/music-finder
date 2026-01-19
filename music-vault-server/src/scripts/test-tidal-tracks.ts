import { TidalClient } from "../lib/tidal/client";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

async function testExtractTracks(albumTidalId: string) {
    console.log(`\n🔍 Iniciando extracción de tracks para el álbum ID: ${albumTidalId}`);
    
    let allExtractedTracks: any[] = [];
    let nextCursor: string | null = null;
    let page = 1;

    try {
        do {
            console.log(`📡 Solicitando página ${page}...`);
            
            const params: any = {
                countryCode: "US",
                include: "items",
                "page[limit]": 50 // Intentamos obtener el máximo posible por página
            };

            if (nextCursor) {
                params["page[cursor]"] = nextCursor;
            }

            const response = await tidal['api'].get(`/v2/albums/${albumTidalId}/relationships/items`, { params });

            // El array 'data' contiene el orden, trackNumber y volumeNumber
            const dataItems = response.data.data || [];
            // El array 'included' contiene los atributos (title, isrc, etc.)
            const includedItems = response.data.included || [];

            // Mapeamos los 'included' por ID para un acceso rápido
            const trackDetailsMap = new Map(
                includedItems.filter((i: any) => i.type === "tracks").map((i: any) => [i.id, i.attributes])
            );

            // Combinamos la información
            const pageTracks = dataItems
                .filter((item: any) => item.type === "tracks")
                .map((item: any) => {
                    const attrs = trackDetailsMap.get(item.id);
                    return {
                        title: attrs?.title,
                        isrc: attrs?.isrc,
                        track_number: item.meta?.trackNumber?.toString(),
                        volume_number: item.meta?.volumeNumber?.toString(),
                        tidal_id: item.id
                    };
                });

            allExtractedTracks = allExtractedTracks.concat(pageTracks);

            // Verificamos paginación
            nextCursor = response.data.links?.meta?.nextCursor || null;
            page++;

        } while (nextCursor);

        console.log("\n" + "=".repeat(50));
        console.log(`✅ EXTRACCIÓN COMPLETA`);
        console.log(`Total de canciones encontradas: ${allExtractedTracks.length}`);
        console.log("=".repeat(50));

        // Mostramos los campos que irán a tu tabla para los primeros registros
        console.log("\n📋 VISTA PREVIA DE LOS DATOS EXTRAÍDOS:");
        allExtractedTracks.slice(0, 5).forEach((t, i) => {
            console.log(`${i + 1}. [Track ${t.track_number} Vol ${t.volume_number}] ${t.title}`);
            console.log(`   ISRC: ${t.isrc} | Tidal ID: ${t.tidal_id}`);
        });

    } catch (error: any) {
        console.error("\n🔴 Error en la extracción:");
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

// Probamos con el ID del álbum 'SOUR' de Olivia Rodrigo que pasaste en el ejemplo
const albumId = "184786791"; 
testExtractTracks(albumId);