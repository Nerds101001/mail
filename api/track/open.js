// api/track/open.js — Email open tracking
// Writes to DB FIRST (Vercel kills async after res.send), then returns pixel

const { neon } = require("@neondatabase/serverless");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS tracking_events (
    id SERIAL PRIMARY KEY,
    lead_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    target_url TEXT,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at BIGINT DEFAULT NULL
  );
`;

module.exports = async (req, res) => {
  const { id } = req.query;

  if (id) {
    try {
      const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
      if (dbUrl) {
        const sql = neon(dbUrl);
        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
        const ua = req.headers["user-agent"] || "unknown";

        // Ensure tables exist then write
        await sql.transaction([
          sql`CREATE TABLE IF NOT EXISTS tracking_events (id SERIAL PRIMARY KEY, lead_id TEXT NOT NULL, event_type TEXT NOT NULL, ip TEXT, user_agent TEXT, target_url TEXT, created_at BIGINT NOT NULL)`,
          sql`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at BIGINT DEFAULT NULL)`,
          sql`INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, created_at) VALUES (${id}, 'open', ${ip}, ${ua}, ${Date.now()})`,
          sql`INSERT INTO kv_store (key, value, expires_at) VALUES (${"track:open:" + id}, '1', NULL) ON CONFLICT (key) DO UPDATE SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT`,
        ]).catch(async () => {
          // Fallback: try individually if transaction fails
          await sql`INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, created_at) VALUES (${id}, 'open', ${ip}, ${ua}, ${Date.now()})`.catch(()=>{});
          await sql`INSERT INTO kv_store (key, value, expires_at) VALUES (${"track:open:" + id}, '1', NULL) ON CONFLICT (key) DO UPDATE SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT`.catch(()=>{});
        });
      }
    } catch(e) {
      console.error("Open track error:", e.message);
    }
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(PIXEL);
};
