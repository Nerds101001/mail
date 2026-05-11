// api/track-open.js
// Serve tracking pixel directly as a 1×1 GIF — NO redirect.
// Redirects (even with Cache-Control: no-store) get cached by Gmail's Image Proxy
// because Gmail caches the entire redirect chain, not just the final response.
// Serving the GIF inline from the same URL forces Gmail to re-request THIS endpoint
// every time the user opens the email, giving us a real tracking hit.

const { trackOpen } = require("./_redis");

// 1×1 transparent GIF (35 bytes)
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { id, cid } = req.query;

  if (id) {
    try {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
                 || req.headers["x-real-ip"]
                 || "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      console.log(`🔍 [OPEN] Lead:${id} Camp:${cid || '—'} IP:${ip} UA:${ua.slice(0, 80)}`);

      const result = await trackOpen(id, ip, ua, cid || null);
      console.log(result.counted
        ? `✅ [OPEN] Counted lead ${id}, total: ${result.count}`
        : `⏭️  [OPEN] Skipped (${result.reason})`);
    } catch (e) {
      console.error(`❌ [OPEN] Lead ${id}:`, e.message);
    }
  }

  // Must-revalidate + no-store: tell Gmail's proxy NOT to cache this response.
  // Serving a direct 200 GIF (not a redirect) so there is no redirect chain to cache.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Length", String(PIXEL.length));
  res.status(200).send(PIXEL);
};
