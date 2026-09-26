import db from "../../db";

const sql = "SELECT COUNT(DISTINCT lower(track_name) || lower(artist_name)) as total FROM play_history";
const result = db.prepare(sql).get() as { total: number };

console.log(`\n🎵 Canciones únicas en el historial: ${result.total}\n`);