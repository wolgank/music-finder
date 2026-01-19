//test-tidal-artist.ts
import { TidalClient } from "../lib/tidal/client";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

async function exploreArtist(artistTidalId: string) {
    console.log(`\n🚀 INICIANDO EXPLORACIÓN PARA ARTISTA ID: ${artistTidalId}`);
    
    let pageCount = 1;
    let nextCursor: string | null = null;

    try {
        do {
            console.log(`\n--- SOLICITANDO PÁGINA ${pageCount} ---`);
            
            const params: any = {
                countryCode: "US",
                include: "albums",
                "page[limit]": 20 // Mantenemos 20 para ver bien la estructura de las páginas
            };

            if (nextCursor) {
                params["page[cursor]"] = nextCursor;
            }

            const url = `/v2/artists/${artistTidalId}/relationships/albums`;
            console.log(`📡 URL: ${url}`);
            console.log(`📡 PARAMS:`, params);

            const response = await tidal['api'].get(url, { params });

            // ------------------------------------------------------------
            // MOSTRAR RESPUESTA CRUDA
            // ------------------------------------------------------------
            console.log(`\n📦 [RESPUESTA API PÁGINA ${pageCount}]:`);
            console.log(JSON.stringify(response.data, null, 2));
            // ------------------------------------------------------------

            const data = response.data.data || [];
            nextCursor = response.data.links?.meta?.nextCursor || null;
            
            console.log(`\n✅ Página ${pageCount} procesada. Items en 'data': ${data.length}`);
            console.log(`⏭️ Siguiente cursor: ${nextCursor || 'FIN DE LA DISCOGRAFÍA'}`);

            if (pageCount >= 2) {
                console.log("\n⚠️ Pausando para no saturar la terminal. Revisa el JSON de arriba.");
                break; // Solo pediremos 2 páginas para que puedas copiar el JSON aquí
            }

            pageCount++;

        } while (nextCursor);

    } catch (error: any) {
        console.error("\n🔴 ERROR EN LA LLAMADA:");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("Mensaje:", error.message);
        }
    }
}

const testId = "16992"; // Björk
exploreArtist(testId);