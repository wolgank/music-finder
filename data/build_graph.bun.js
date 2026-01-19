// build_graph.bun.js
import { sleep } from "bun";

const LASTFM_API_KEY = "19c3930bbfbb155798bb98bd0f6081d3"; // <--- PEGA TU KEY AQUI
const INPUT_FILE = "resumen_musical.json";
const OUTPUT_FILE = "grafo_musical.json";

// Tags que ignoraremos porque no aportan valor al grafo
const BLACKLIST_TAGS = ["seen live", "under 2000 listeners", "favorites", "spotify", "albums I own"];

async function main() {
    console.log("🏗️  Iniciando construcción del Grafo Musical...");

    // 1. Cargar tu historial
    const file = Bun.file(INPUT_FILE);
    const data = await file.json();
    
    // Tomamos los top 50 artistas para que el grafo no sea una bola de pelos ilegible
    // (Puedes subir este número si quieres más densidad)
    const topArtists = data.my_music.slice(0, 50);

    let nodes = [];
    let links = [];
    let tagsMap = new Map(); // Para contar qué géneros son los más comunes

    console.log(`📊 Procesando ${topArtists.length} artistas principales...`);

    for (const [index, artist] of topArtists.entries()) {
        const name = artist.artist;
        
        // Agregar nodo de Artista
        nodes.push({
            id: name,
            group: "artist",
            val: artist.stats.total_plays, // Tamaño basado en reproducciones
            img: null // El visor se encargará de buscar la imagen en iTunes
        });

        // Consultar Last.fm
        try {
            console.log(`   [${index + 1}/${topArtists.length}] Consultando tags para: ${name}`);
            const url = `http://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&artist=${encodeURIComponent(name)}&api_key=${LASTFM_API_KEY}&format=json`;
            
            const res = await fetch(url);
            const json = await res.json();
            
            if (json.toptags && json.toptags.tag) {
                // Tomamos solo los top 4 tags por artista para definir su "esencia"
                const tags = json.toptags.tag.slice(0, 4);

                for (const tagObj of tags) {
                    const tagName = tagObj.name.toLowerCase();

                    if (BLACKLIST_TAGS.includes(tagName)) continue;

                    // Agregar o actualizar nodo de Tag (Género/Mood)
                    if (!tagsMap.has(tagName)) {
                        tagsMap.set(tagName, 0);
                        nodes.push({
                            id: tagName,
                            group: "tag",
                            val: 1 // Tamaño inicial
                        });
                    }
                    tagsMap.set(tagName, tagsMap.get(tagName) + 1);

                    // Crear conexión Artista -> Tag
                    links.push({
                        source: name,
                        target: tagName,
                        value: 1
                    });
                }
            }
        } catch (e) {
            console.error(`❌ Error con ${name}:`, e.message);
        }

        // Dormir un poco para no saturar la API (Rate Limiting)
        await sleep(200); 
    }

    // Actualizar tamaño de los nodos de Tags basado en cuántos artistas tienen ese tag
    nodes = nodes.map(n => {
        if (n.group === "tag") {
            return { ...n, val: tagsMap.get(n.id) * 5 }; // Multiplicamos para que se vean más grandes
        }
        return n;
    });

    const graphData = { nodes, links };
    await Bun.write(OUTPUT_FILE, JSON.stringify(graphData, null, 2));

    console.log(`✅ ¡Grafo generado! Guardado en: ${OUTPUT_FILE}`);
    console.log(`   Nodos: ${nodes.length}, Conexiones: ${links.length}`);
}

main();