// music-vault-server/src/lib/tidal/client.ts
import axios, { type AxiosInstance } from "axios";
import { TidalAuth } from "./auth";

export interface TrackCriteria {
  title: string;
  artist: string;
  album?: string;
}

export class TidalClient {
  private auth: TidalAuth;
  private api: AxiosInstance;

  constructor(clientId: string, clientSecret: string) {
    this.auth = new TidalAuth(clientId, clientSecret);
    
    this.api = axios.create({
      baseURL: "https://openapi.tidal.com",
      headers: { 
        "Accept": "application/vnd.api+json", 
        "Content-Type": "application/vnd.api+json",
        "X-Tidal-Country-Code": "PE" 
      },
    });

    this.api.interceptors.request.use(async (config) => {
      const token = await this.auth.getToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }
  /**
   * Obtiene los detalles y construye la imagen DIRECTAMENTE desde el UUID.
   */
  async getTrackDetails(trackId: string) {
    try {
      const response = await this.api.get(`/v2/tracks/${trackId}`, {
        params: { 
          countryCode: "PE",
          include: "artists,albums" 
        }
      });

      const mainDoc = response.data;
      const trackData = mainDoc.data;
      const included = mainDoc.included || [];
      const attributes = trackData.attributes;

      // 1. Resolver Artista
      const artistRel = trackData.relationships?.artists?.data?.[0];
      const artistObj = artistRel 
        ? included.find((x: any) => x.type === "artists" && x.id === artistRel.id)
        : null;

      // 2. Resolver Álbum
      const albumRel = trackData.relationships?.albums?.data?.[0];
      const albumObj = albumRel 
        ? included.find((x: any) => x.type === "albums" && x.id === albumRel.id)
        : null;

      // 3. RECUPERAR IMAGEN (MÉTODO UUID DIRECTO)
      let coverUrl = null;
      
      // Intentamos sacar el UUID del cover de dos lugares posibles
      const coverId = albumObj?.relationships?.coverArt?.data?.id || albumObj?.attributes?.cover;

      if (coverId) {
          // Tu lógica ganadora: Reemplazar guiones por barras y construir URL
          const path = coverId.replace(/-/g, '/'); 
          coverUrl = `https://resources.tidal.com/images/${path}/1280x1280.jpg`;
      }

      // 4. PARSEAR DURACIÓN (PT3M48S -> Segundos)
      let durationSeconds = 0;
      if (attributes.duration && typeof attributes.duration === 'string') {
          // Regex simple para capturar minutos y segundos de "PT3M48S"
          const match = attributes.duration.match(/PT(\d+)M(\d+(\.\d+)?)S/);
          if (match) {
              durationSeconds = (parseInt(match[1]) * 60) + Math.floor(parseFloat(match[2]));
          }
      } else {
          durationSeconds = attributes.duration || 0;
      }

      return {
        id: trackData.id,
        name: attributes.title,
        artist: artistObj?.attributes?.name || "Desconocido",
        album: albumObj?.attributes?.title || "Single",
        duration: durationSeconds,    // Ahora es un número (ej. 228)
        explicit: attributes.explicit, 
        isrc: attributes.isrc,
        image: coverUrl,              // ✅ Ahora sí debería salir la URL
        url: attributes.url || `https://tidal.com/browse/track/${trackData.id}`
      };

    } catch (e: any) {
      console.error(`❌ Error obteniendo detalles para track ${trackId}:`, e.message);
      return null;
    }
  }

  /**
   * LÓGICA DE FUERZA BRUTA INTELIGENTE
   * 1. Busca IDs.
   * 2. "Hidrata" los primeros 5 resultados (pide sus detalles completos).
   * 3. Filtra con los datos reales.
   */
  async findExactTrack(criteria: TrackCriteria) {
    try {
      const query = `${criteria.artist} ${criteria.title}`;
      console.log(`📡 Buscando IDs para: "${query}"`);

      const encodedQuery = encodeURIComponent(query);
      
      // Usamos el endpoint de relationships que tú descubriste que devuelve la lista limpia
      const response = await this.api.get(`/v2/searchResults/${encodedQuery}/relationships/tracks`, {
        params: { 
            countryCode: "PE", 
            limit: 5 // Solo revisamos los top 5 para no ser lentos
        }
      });

      // Tu primer curl muestra que la lista de IDs viene directamente en 'data'
      const candidateList = response.data.data; 

      if (!candidateList || !Array.isArray(candidateList) || candidateList.length === 0) {
        console.warn("⚠️ No se encontraron IDs candidatos.");
        return null;
      }

      console.log(`🔎 Analizando los primeros ${candidateList.length} candidatos...`);

      // LOOP DE VERIFICACIÓN
      for (const candidate of candidateList) {
          // Llamamos al detalle para ver si es la canción correcta
          const details = await this.getTrackDetails(candidate.id);
          
          if (!details) continue;

          // Normalización para comparar (minúsculas)
          const foundTitle = details.name.toLowerCase();
          const targetTitle = criteria.title.toLowerCase();
          const foundArtist = details.artist.toLowerCase();
          const targetArtist = criteria.artist.toLowerCase();

          // Lógica de Coincidencia
          // 1. El título debe parecerse
          if (!foundTitle.includes(targetTitle)) continue;

          // 2. El artista debe coincidir (La prueba de fuego)
          if (foundArtist.includes(targetArtist) || targetArtist.includes(foundArtist)) {
              return details; // ¡ENCONTRADO!
          }
      }

      console.warn(`⚠️ Se revisaron ${candidateList.length} tracks pero el artista no coincidía.`);
      return null;

    } catch (e: any) {
      console.error("❌ ERROR GENERAL:", e.message);
      return null;
    }
  }
}