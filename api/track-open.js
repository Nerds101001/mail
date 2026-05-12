// api/track-open.js
//
// Gmail multiple-open tracking strategy:
//
//  Problem: Gmail Image Proxy fetches the pixel once and caches it.
//           All subsequent opens are served from Google's CDN → server never hit again.
//
//  Solution (two-stage response):
//
//  Stage 1 — delivery scanner (within 5s of send, 66.249.x.x or similar):
//    → Return 204 No Content
//    → Gmail receives no image bytes, so it has NOTHING to cache for this URL
//    → On every future open, Gmail must re-request /api/track-open
//
//  Stage 2 — real user open (>5s, or known proxy IPs like 74.125.x.x):
//    → Run trackOpen() to record the event in DB
//    → Return 302 → /api/track-pixel?t=UNIQUE_TOKEN
//    → Each unique token means Gmail can't serve a cached response for the source URL
//    → Gmail has to re-request /api/track-open on the next open → counted again
//
//  Result: every Gmail open after the first gets tracked, not just the first one.

const { trackOpen } = require("./_redis");
const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { id, cid } = req.query;

  let deliveryScan = false;

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

      // Delivery scanner = blocked by 5s timing guard
      deliveryScan = (!result.counted && result.reason === 'scanner guard (5s)');
    } catch (e) {
      console.error(`❌ [OPEN] Lead ${id}:`, e.message);
    }
  }

  if (deliveryScan) {
    // Return 204 — no image body for Gmail to cache.
    // Forces Gmail to re-request this URL on every future open.
    console.log(`📭 [OPEN] 204 returned for delivery scan — Gmail will re-request on each user open`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(204).end();
  }

  // Real open (or no id) — 302 to a per-request unique token.
  // Unique token = Gmail has no cached response for this redirect destination.
  // Gmail must re-request /api/track-open on the next open → tracked again.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
  res.redirect(302, `${APP_URL}/api/track-pixel?t=${token}`);
};
