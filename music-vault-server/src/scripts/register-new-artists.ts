//register-new-artists.ts
import db from '../db';
import { TidalClient } from "../lib/tidal/client";
import * as fs from 'fs';
import { randomUUID } from "crypto";
import "dotenv/config";

const tidal = new TidalClient(process.env.TIDAL_CLIENT_ID!, process.env.TIDAL_CLIENT_SECRET!);

// Función simple para limpiar nombres (name_clean)
function cleanName(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, "")
        .trim();
}

async function registerArtists() {
    console.log("👤 INICIANDO REGISTRO DE ARTISTAS DESDE MANUAL LINKS");
    console.log("=".repeat(50));

    const DECISIONS_FILE = 'cleanup_decisions.json';
    if (!fs.existsSync(DECISIONS_FILE)) {
        console.error("🔴 Error: No se encontró cleanup_decisions.json");
        return;
    }

    const decisions = JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf-8'));
    const pendingArtists = decisions.manual_links.filter((m: any) => m.status === "pending_download");

    console.log(`📋 Artistas por procesar: ${pendingArtists.length}`);

    let savedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const artist of pendingArtists) {
        process.stdout.write(`⏳ Procesando: ${artist.artist_name}... `);

        try {
            // 1. Verificar si el tidal_id ya existe en la DB para evitar duplicados
            const existingById = db.prepare("SELECT name FROM artists WHERE tidal_id = ?").get(artist.correct_tidal_id) as any;
            
            // 2. Verificar si el nombre ya existe (por si acaso tiene otro tidal_id previo)
            const existingByName = db.prepare("SELECT id FROM artists WHERE LOWER(name) = LOWER(?)").get(artist.artist_name) as any;

            if (existingById || existingByName) {
                console.log(`⚠️  SALTADO (Ya existe como "${existingById?.name || artist.artist_name}")`);
                skippedCount++;
                // Marcamos como procesado para que no vuelva a aparecer en este script
                artist.status = "registered"; 
                continue;
            }

            // 3. Opcional: Podríamos validar contra la API aquí si quisiéramos el nombre EXACTO de Tidal,
            // pero como pediste usar el nombre del JSON, procedemos al INSERT.
            
            const newId = randomUUID();
            const now = new Date().toISOString();
            const nameClean = cleanName(artist.artist_name);

            db.prepare(`
                INSERT INTO artists (id, name, tidal_id, created_at, name_clean)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                newId,
                artist.artist_name,
                artist.correct_tidal_id,
                now,
                nameClean
            );

            console.log(`✅ GUARDADO (ID: ${artist.correct_tidal_id})`);
            artist.status = "registered";
            savedCount++;

        } catch (error: any) {
            console.log(`❌ ERROR: ${error.message}`);
            errorCount++;
        }

        // Guardar progreso en el JSON después de cada artista para no perder datos si se interrumpe
        fs.writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2));
    }

    console.log("\n" + "=".repeat(50));
    console.log("📊 RESUMEN DE REGISTRO:");
    console.log(`✅ Artistas guardados nuevos: ${savedCount}`);
    console.log(`⚠️  Artistas omitidos (ya existían): ${skippedCount}`);
    console.log(`🔴 Errores encontrados: ${errorCount}`);
    console.log("=".repeat(50));
    console.log("🚀 Todos los artistas en status 'registered' están listos para la cosecha de álbumes.");
}

registerArtists();