// api/track-open.js
//
// Multiple-open tracking strategy:
//
//  ALWAYS return 204 No Content — for every single hit (delivery scan, real open, bot).
//
//  Why 204 works for multiple opens:
//    Gmail Image Proxy caches the RESPONSE of the pixel URL.
//    → 204 = no content = nothing to cache → Gmail MUST re-fetch on every open.
//    → 302 = redirect = Gmail caches the destination → never re-fetches → only 1 open counted.
//
//  Flow:
//    Email sent          → first-hit key = 'pending'
//    Delivery scan       → key 'pending' → mark 'seen', return 204  (not counted)
//    User opens (1st)    → key 'seen'   → count, return 204         (counted, Gmail re-fetches next open)
//    User opens (2nd)    → key 'seen'   → count, return 204         (counted again ✅)
//    User opens (Nth)    → key 'seen'   → count, return 204         (counted again ✅)
//
//  Hard-blocked IPs (Apple MPP, MS SafeLinks etc.) → not counted, 204 returned.

const { trackOpen } = require("./_redis");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

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

      if (result.reason === 'first hit') {
        console.log(`📭 [OPEN] Delivery scan blocked — Gmail will re-request on real open`);
      }
    } catch (e) {
      console.error(`❌ [OPEN] Lead ${id}:`, e.message);
    }
  }

  // ALWAYS 204 — Gmail never caches → re-fetches on every open → multiple opens tracked.
  return res.status(204).end();
};
