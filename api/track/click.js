// api/track/click.js — Email click tracking
// Uses Postgres-backed KV store for tracking

const { incr, logEvent } = require("../_redis");

function isSafeUrl(u) {
  try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; }
}

module.exports = async (req, res) => {
  const { id, url } = req.query;
  const decoded = decodeURIComponent(url || "");

  if (id) {
    console.log(`[TRACK CLICK] Lead ID: ${id}, URL: ${decoded}`);
    try {
      // Increment counter in kv_store
      const count = await incr(`track:click:${id}`);
      console.log(`[TRACK CLICK] Count for ${id}: ${count}`);

      // Log detailed event
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
      const ua = req.headers["user-agent"] || "unknown";
      
      await logEvent({
        lead_id: id,
        event_type: 'click',
        ip: ip,
        user_agent: ua,
        target_url: decoded
      });
      
      console.log(`[TRACK CLICK] Event logged for ${id}`);
    } catch(e) {
      console.error("[TRACK CLICK] Error:", e.message, e.stack);
    }
  }

  res.redirect(302, decoded && isSafeUrl(decoded) ? decoded : "https://enginerds.in");
};
