// api/track/click.js — Email click tracking
// Writes to BOTH DB and Redis for dual tracking

const { neon } = require("@neondatabase/serverless");
const { incr } = require("../_redis");

function isSafeUrl(u) {
  try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; }
}

module.exports = async (req, res) => {
  const { id, url } = req.query;
  const decoded = decodeURIComponent(url || "");

  if (id) {
    try {
      // Update Redis counter (for fast stats retrieval)
      await incr(`track:click:${id}`).catch(e => console.error("Redis incr failed:", e.message));

      // Also write to database for detailed event log
      const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
      if (dbUrl) {
        const sql = neon(dbUrl);
        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
        const ua = req.headers["user-agent"] || "unknown";

        await sql.transaction([
          sql`CREATE TABLE IF NOT EXISTS tracking_events (id SERIAL PRIMARY KEY, lead_id TEXT NOT NULL, event_type TEXT NOT NULL, ip TEXT, user_agent TEXT, target_url TEXT, created_at BIGINT NOT NULL)`,
          sql`INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, created_at) VALUES (${id}, 'click', ${ip}, ${ua}, ${decoded}, ${Date.now()})`,
        ]).catch(async () => {
          await sql`INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, created_at) VALUES (${id}, 'click', ${ip}, ${ua}, ${decoded}, ${Date.now()})`.catch(()=>{});
        });
      }
    } catch(e) {
      console.error("Click track error:", e.message);
    }
  }

  res.redirect(302, decoded && isSafeUrl(decoded) ? decoded : "https://enginerds.in");
};
