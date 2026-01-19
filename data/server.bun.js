// server.bun.js
import { serve, file } from "bun";

const PORT = 3000;

console.log(`🚀 Servidor (Edición iTunes V2) corriendo en: http://localhost:${PORT}`);

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // 1. Servir HTML
    if (url.pathname === "/") {
      return new Response(file("visor.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // 2. Servir Datos JSON
    if (url.pathname === "/api/data") {
      return new Response(file("resumen_musical.json"), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. API BRIDGE (iTunes Search)
    if (url.pathname === "/api/artist-info") {
        const artistName = url.searchParams.get("name");
        if (!artistName) return new Response("Falta nombre", { status: 400 });

        try {
            // DOCUMENTACIÓN OFICIAL: https://performance-partners.apple.com/search-api
            // Usamos entity=album para garantizar que recibimos 'artworkUrl100'
            const iTunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&media=music&entity=album&limit=1`;
            
            const response = await fetch(iTunesUrl);
            const data = await response.json();
            const result = data.results?.[0];

            if (result) {
                // Truco de calidad: iTunes da 100x100, cambiamos el string a 600x600
                const highResImage = result.artworkUrl100?.replace('100x100bb', '600x600bb');

                return new Response(JSON.stringify({
                    found: true,
                    name: result.artistName,
                    image: highResImage,
                    genre: result.primaryGenreName,
                    url: result.artistViewUrl || result.collectionViewUrl
                }), { headers: { "Content-Type": "application/json" }});
            }
            
            return new Response(JSON.stringify({ found: false }), { status: 404 });
        } catch (error) {
            console.error("Error en iTunes API:", error);
            return new Response(JSON.stringify({ error: "Error interno" }), { status: 500 });
        }
    }
    if (url.pathname === "/api/graph") {
        const graphFile = Bun.file("grafo_musical.json");
        if (await graphFile.exists()) {
            return new Response(graphFile, { headers: { "Content-Type": "application/json" } });
        } else {
            return new Response(JSON.stringify({ error: "Ejecuta build_graph.bun.js primero" }), { status: 404 });
        }
    }

    return new Response("No encontrado", { status: 404 });
  },
});