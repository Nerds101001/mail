// api/track/open.js — Email open tracking
// Writes to BOTH DB and Redis for dual tracking

const { neon } = require("@neondatabase/serverless");
const { incr } = require("../_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  const { id } = req.query;

  if (id) {
    try {
      // Update Redis counter (for fast stats retrieval)
      await incr(`track:open:${id}`).catch(e => console.error("Redis incr failed:", e.message));

      // Also write to database for detailed event log
      const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
      if (dbUrl) {
        const sql = neon(dbUrl);
        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
        const ua = req.headers["user-agent"] || "unknown";

        // Ensure tables exist then write
        await sql.transaction([
          sql`CREATE TABLE IF NOT EXISTS tracking_events (id SERIAL PRIMARY KEY, lead_id TEXT NOT NULL, event_type TEXT NOT NULL, ip TEXT, user_agent TEXT, target_url TEXT, created_at BIGINT NOT NULL)`,
          sql`INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, created_at) VALUES (${id}, 'open', ${ip}, ${ua}, ${Date.now()})`,
        ]).catch(async () => {
          // Fallback: try individually if transaction fails
          await sql`INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, created_at) VALUES (${id}, 'open', ${ip}, ${ua}, ${Date.now()})`.catch(()=>{});
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
