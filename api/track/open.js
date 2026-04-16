const { incr, logEvent } = require("../_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  const { id } = req.query;

  if (id) {
    try {
      const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.headers["x-real-ip"] || "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      // Run both writes in parallel — handled by our unified helper
      await Promise.all([
        incr(`track:open:${id}`).catch(() => {}),
        logEvent({ lead_id: id, event_type: "open", ip, user_agent: ua }).catch(() => {}),
      ]);
    } catch(e) {
      console.error("Open track error:", e.message);
    }
  }

  // Send pixel
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(PIXEL);
};
