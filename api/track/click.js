// api/track/click.js — Two-step email click tracking
// Step 1: Redirect immediately
// Step 2: Log event with timestamp, IP, user-agent, target URL

const { neon } = require("@neondatabase/serverless");

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

async function logClick(id, targetUrl, req) {
  try {
    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!url) return;
    const sql = neon(url);

    await sql`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id         SERIAL PRIMARY KEY,
        lead_id    TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ip         TEXT,
        user_agent TEXT,
        target_url TEXT,
        created_at BIGINT NOT NULL
      )
    `;

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
            || req.headers["x-real-ip"]
            || "unknown";
    const ua = req.headers["user-agent"] || "unknown";

    await sql`
      INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, created_at)
      VALUES (${id}, 'click', ${ip}, ${ua}, ${targetUrl}, ${Date.now()})
    `;

    await sql`
      INSERT INTO kv_store (key, value, expires_at)
      VALUES (${"track:click:" + id}, '1', NULL)
      ON CONFLICT (key) DO UPDATE
        SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT
    `;
  } catch(e) {
    console.error("Click track log error:", e.message);
  }
}

module.exports = async (req, res) => {
  const { id, url } = req.query;
  const decoded = decodeURIComponent(url || "");

  // Step 1 — Redirect IMMEDIATELY
  if (decoded && isSafeUrl(decoded)) {
    res.redirect(302, decoded);
  } else {
    res.redirect(302, "https://enginerds.in");
  }

  // Step 2 — Log event async after redirect
  if (id) logClick(id, decoded, req);
};
