import db from "../../db";
import { TidalClient } from "../../lib/tidal/client";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);
const ARTIST_TIDAL_ID = "7337530"; // El Cuarteto de Nos
const CHUNK_SIZE = 20;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cleanString(str: string) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/\(.*\)/g, "")
        .replace(/deluxe|remaster|edition|version|feat\.|live/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

async function contrast() {
  console.log(`⚖️  CONTRASTE DE DATOS: EL CUARTETO DE NOS`);
  console.log("-----------------------------------------------------------");

  // 1. OBTENER LO QUE HAY EN LA DB (LOCAL)
  const localAlbums = db.prepare(`
    SELECT title 
    FROM albums 
    WHERE artist_id IN (SELECT id FROM artists WHERE tidal_id = ?)
  `).all(ARTIST_TIDAL_ID) as { title: string }[];

  const localTitlesSet = new Set(localAlbums.map(a => cleanString(a.title)));

  console.log(`💾 EN TU BASE DE DATOS: ${localAlbums.length} lanzamientos.`);
  // Mostrar algunos ejemplos locales
  console.log(`   (Ejemplos: ${localAlbums.slice(0, 3).map(a => a.title).join(", ")}...)`);

  // 2. OBTENER LO QUE HAY EN TIDAL (REMOTO - PAGINADO)
  console.log("\n🌍 CONSULTANDO TIDAL (Paginación completa)...");
  
  let allIds: string[] = [];
  let nextCursor: string | null = null;
  let hasMore = true;

  try {
      while (hasMore) {
          const params: any = { countryCode: "PE", limit: 100 };
          if (nextCursor) params["page[cursor]"] = nextCursor;

          const res = await tidal['api'].get(`/v2/artists/${ARTIST_TIDAL_ID}/relationships/albums`, { params });
          const data = res.data.data || [];
          data.forEach((item: any) => allIds.push(item.id));
          
          nextCursor = res.data.links?.meta?.nextCursor;
          if (!nextCursor || data.length === 0) hasMore = false;
          process.stdout.write(".");
          await sleep(100);
      }
  } catch (e: any) {
      console.error("❌ Error API:", e.message);
      return;
  }
  console.log(` OK. Encontrados ${allIds.length} IDs.`);

  // 3. DESCARGAR NOMBRES PARA COMPARAR
  console.log("🔍 Bajando detalles para comparar...");
  let missingAlbums: string[] = [];
  let foundKeyAlbums = { "Raro": false, "Porfiado": false, "Bipolar": false };

  for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
      const chunk = allIds.slice(i, i + CHUNK_SIZE);
      try {
          const res = await tidal['api'].get(`/v2/albums`, {
              params: { "filter[id]": chunk.join(","), countryCode: "PE" }
          });
          
          const remotes = res.data.data || [];
          
          for (const rem of remotes) {
              const title = rem.attributes.title;
              const cleanTitle = cleanString(title);
              
              // CHEQUEO CLAVE
              if (cleanTitle.includes("raro")) foundKeyAlbums["Raro"] = true;
              if (cleanTitle.includes("porfiado")) foundKeyAlbums["Porfiado"] = true;
              if (cleanTitle.includes("bipolar")) foundKeyAlbums["Bipolar"] = true;

              // Si NO está en el set local, es un faltante
              if (!localTitlesSet.has(cleanTitle)) {
                  missingAlbums.push(`${rem.attributes.releaseDate} - ${title} [${rem.attributes.type}]`);
              }
          }
      } catch (e) { process.stdout.write("x"); }
      await sleep(100);
  }

  // 4. REPORTE FINAL
  console.log("\n-----------------------------------------------------------");
  console.log(`🚨 RESULTADO DEL CONTRASTE:`);
  console.log(`   Faltan ${missingAlbums.length} discos en tu base de datos.`);
  
  if (missingAlbums.length > 0) {
      console.log("\n📜 LISTA DE FALTANTES (Muestra):");
      // Ordenar por fecha para ver los viejos
      missingAlbums.sort().slice(0, 15).forEach(m => console.log(`   ❌ ${m}`));
      if (missingAlbums.length > 15) console.log(`      ... y ${missingAlbums.length - 15} más.`);
  } else {
      console.log("✅ ¡Increíble! Tienes todo sincronizado.");
  }

  console.log("\n🕵️ VERIFICACIÓN DE CLÁSICOS:");
  console.log(`   Raro:     ${foundKeyAlbums["Raro"] ? "✅ Encontrado en Tidal (Falta importar)" : "❌ No aparece en Tidal"}`);
  console.log(`   Porfiado: ${foundKeyAlbums["Porfiado"] ? "✅ Encontrado en Tidal (Falta importar)" : "❌ No aparece en Tidal"}`);
  console.log(`   Bipolar:  ${foundKeyAlbums["Bipolar"] ? "✅ Encontrado en Tidal (Falta importar)" : "❌ No aparece en Tidal"}`);
}

contrast();