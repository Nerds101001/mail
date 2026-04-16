// api/track/click.js — Email click tracking
// Writes to DB FIRST (Vercel kills async after res.redirect), then redirects

const { neon } = require("@neondatabase/serverless");

function isSafeUrl(u) {
  try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; }
}

module.exports = async (req, res) => {
  const { id, url } = req.query;
  const decoded = decodeURIComponent(url || "");

  if (id) {
    try {
      const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
      if (dbUrl) {
        const sql = neon(dbUrl);
        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
        const ua = req.headers["user-agent"] || "unknown";

        await sql.transaction([
          sql`CREATE TABLE IF NOT EXISTS tracking_events (id SERIAL PRIMARY KEY, lead_id TEXT NOT NULL, event_type TEXT NOT NULL, ip TEXT, user_agent TEXT, target_url TEXT, created_at BIGINT NOT NULL)`,
          sql`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at BIGINT DEFAULT NULL)`,
          sql`INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, created_at) VALUES (${id}, 'click', ${ip}, ${ua}, ${decoded}, ${Date.now()})`,
          sql`INSERT INTO kv_store (key, value, expires_at) VALUES (${"track:click:" + id}, '1', NULL) ON CONFLICT (key) DO UPDATE SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT`,
        ]).catch(async () => {
          await sql`INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, created_at) VALUES (${id}, 'click', ${ip}, ${ua}, ${decoded}, ${Date.now()})`.catch(()=>{});
          await sql`INSERT INTO kv_store (key, value, expires_at) VALUES (${"track:click:" + id}, '1', NULL) ON CONFLICT (key) DO UPDATE SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT`.catch(()=>{});
        });
      }
    } catch(e) {
      console.error("Click track error:", e.message);
    }
  }

  res.redirect(302, decoded && isSafeUrl(decoded) ? decoded : "https://enginerds.in");
};
