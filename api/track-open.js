// api/track-open.js
//
// Gmail Image Proxy caching behaviour (confirmed May 2026):
//   1. Delivery scan  — 66.249.x.x hits our URL, Google caches the response
//   2. User open      — Gmail serves the CACHED response; never hits us again
//
// Fix: return 404 to 66.249.x.x so Google marks the image as "failed" and
// does NOT cache it. When the user actually opens, Gmail re-fetches from us
// (via 74.125.x.x / user-proxy IPs) and we record the open.
//
// For the timing guard (non-Google IPs within 15s of send): return 204 so
// the browser gets a valid response but we don't count it.

const { trackOpen, isDeliveryPrefetchIp: _unused } = require("./_redis");

// 1×1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function isDeliveryPrefetch(ip) {
  return /^66\.249\./.test(ip || "");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const { id, cid } = req.query;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
             || req.headers["x-real-ip"]
             || "unknown";
  const ua = req.headers["user-agent"] || "unknown";

  console.log(`🔍 [OPEN] Lead:${id||'?'} Camp:${cid||'—'} IP:${ip} UA:${ua.slice(0, 80)}`);

  // ── Delivery pre-fetch: return 404 so Google does NOT cache the image ──
  // Gmail will re-fetch when user opens, giving us a countable 74.125.x.x hit.
  if (isDeliveryPrefetch(ip)) {
    console.log(`🛡️ [OPEN] Delivery pre-fetch 404'd for lead ${id}: ${ip}`);
    return res.status(404).end();
  }

  // ── All other requests: run tracking then serve pixel ─────────────────
  if (id) {
    try {
      const result = await trackOpen(id, ip, ua, cid || null);
      console.log(result.counted
        ? `✅ [OPEN] Counted lead ${id}, total: ${result.count}`
        : `⏭️  [OPEN] Skipped (${result.reason})`);
    } catch (e) {
      console.error(`❌ [OPEN] Lead ${id}:`, e.message);
    }
  }

  res.setHeader("Content-Type", "image/gif");
  res.send(PIXEL);
};
