// api/track/open.js — Email open tracking
// Uses Postgres-backed KV store for tracking

const { incr, logEvent } = require("../_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  const { id } = req.query;

  if (id) {
    console.log(`[TRACK OPEN] Lead ID: ${id}`);
    try {
      // Increment counter in kv_store
      const count = await incr(`track:open:${id}`);
      console.log(`[TRACK OPEN] Count for ${id}: ${count}`);

      // Log detailed event
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
      const ua = req.headers["user-agent"] || "unknown";
      
      await logEvent({
        lead_id: id,
        event_type: 'open',
        ip: ip,
        user_agent: ua,
        target_url: null
      });
      
      console.log(`[TRACK OPEN] Event logged for ${id}`);
    } catch(e) {
      console.error("[TRACK OPEN] Error:", e.message, e.stack);
    }
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(PIXEL);
};
