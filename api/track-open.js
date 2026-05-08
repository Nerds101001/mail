// api/track-open.js
// Serves the 1x1 tracking pixel GIF directly (no redirect).
// No redirect = no cacheable final URL = Gmail must re-request this endpoint
// on every open. Cache-Control: no-store forces a fresh hit each time.

const { trackOpen } = require("./_redis");

// 1×1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // No-store forces Gmail Image Proxy to re-fetch on every open
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "image/gif");

  const { id, cid } = req.query;

  if (id) {
    try {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
                 || req.headers["x-real-ip"]
                 || "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      console.log(`🔍 [OPEN] Lead:${id} Camp:${cid||'—'} IP:${ip} UA:${ua.slice(0, 80)}`);

      const result = await trackOpen(id, ip, ua, cid || null);
      console.log(result.counted
        ? `✅ [OPEN] Counted lead ${id}, total: ${result.count}`
        : `⏭️  [OPEN] Skipped (${result.reason})`);
    } catch (e) {
      console.error(`❌ [OPEN] Lead ${id}:`, e.message);
    }
  }

  // Serve pixel directly — no redirect, so Gmail can't cache a "final" URL
  res.send(PIXEL);
};
