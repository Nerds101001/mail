// api/track/open.js — Two-step email open tracking
// Step 1: Return pixel immediately (never block recipient)
// Step 2: Log event with timestamp, IP, user-agent to DB

const { neon } = require("@neondatabase/serverless");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

async function logOpen(id, req) {
  try {
    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!url) return;
    const sql = neon(url);

    // Ensure events table exists
    await sql`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id         SERIAL PRIMARY KEY,
        lead_id    TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ip         TEXT,
        user_agent TEXT,
        created_at BIGINT NOT NULL
      )
    `;

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
            || req.headers["x-real-ip"]
            || "unknown";
    const ua = req.headers["user-agent"] || "unknown";

    // Insert event log
    await sql`
      INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, created_at)
      VALUES (${id}, 'open', ${ip}, ${ua}, ${Date.now()})
    `;

    // Update aggregate counter in kv_store
    await sql`
      INSERT INTO kv_store (key, value, expires_at)
      VALUES (${"track:open:" + id}, '1', NULL)
      ON CONFLICT (key) DO UPDATE
        SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT
    `;
  } catch(e) {
    console.error("Open track log error:", e.message);
  }
}

module.exports = async (req, res) => {
  const { id } = req.query;

  // Step 1 — Return pixel IMMEDIATELY, never block
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(PIXEL);

  // Step 2 — Log event async after response sent
  if (id) logOpen(id, req);
};
