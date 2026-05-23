// api/track-open.js
//
// Gmail multiple-open tracking strategy (matches working Vercel version):
//
//  Problem: Gmail Image Proxy fetches the pixel once and caches it.
//           All subsequent opens are served from Google's CDN → server never hit again.
//
//  Solution (two-stage response):
//
//  Stage 1 — delivery scanner (66.249.x within 5s of send):
//    → Return 204 No Content
//    → Gmail receives no image bytes → nothing to cache for this URL
//    → On real user open, Gmail must re-request /api/track-open
//    → Gmail proxy (74.125.x) fires → counted ✅
//
//  Stage 2 — real user open (74.125.x proxy, or any IP after 5s guard):
//    → Run trackOpen() to record the event in DB
//    → Return 302 → /api/track-pixel?t=UNIQUE_TOKEN
//    → Unique token = Gmail can't serve cached response for the source URL
//    → Next open: Gmail re-requests /api/track-open → tracked again ✅
//
//  Hard-blocked IPs (Apple MPP 17.x, Microsoft SafeLinks, Google SafeBrowse etc.)
//    → Return 204 — these are server-side scanners, not real user opens

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

      // 204 only for scanner guard (5s) — exact Vercel behaviour.
      // This tells Gmail "no image here" → Gmail re-requests on real user open.
      // Everything else (dedup, att-guard) gets 302 → unique URL.
      deliveryScan = result.reason === 'scanner guard (5s)';
    } catch (e) {
      console.error(`❌ [OPEN] Lead ${id}:`, e.message);
    }
  }

  if (deliveryScan) {
    // 204 = no image body. Gmail has nothing to cache for this URL.
    // Forces Gmail to re-request this URL on the next real open.
    console.log(`📭 [OPEN] 204 returned — Gmail will re-request on next open`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(204).end();
  }

  // Real open (counted) or dedup skip — 302 to unique token URL.
  // Gmail caches at the token URL destination, not at our source URL.
  // So next open hits our source URL fresh → tracked again.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
  res.redirect(302, `${APP_URL}/api/track-pixel?t=${token}`);
};
