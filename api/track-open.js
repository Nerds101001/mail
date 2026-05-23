// api/track-open.js
//
// Gmail multi-open tracking strategy:
//
//  Problem: Gmail Image Proxy caches the FIRST response it gets.
//           If we return 204 (no content) for a delivery scan, Gmail caches
//           "no image at this URL" and never re-requests it → real opens missed.
//
//  Solution (unified 302 strategy):
//
//  ALL responses → 302 → /api/track-pixel?t=UNIQUE_TOKEN
//    • The unique token is different every request.
//    • Gmail caches at the DESTINATION (unique token URL), NOT at the source URL.
//    • So next time the user opens, Gmail re-requests the SOURCE URL → we see it.
//    • Whether we COUNT the open is decided by bot detection / timing guard in _redis.js.
//    • This keeps Gmail always re-fetching our source URL on every open.
//
//  Exception: hard-blocked bot IPs (66.249.x, 17.x, 172.253.x etc.) get 204
//    because they are NOT Gmail's image proxy — they don't affect Gmail caching.
//    Returning 204 to these saves bandwidth and prevents any caching on their side.

const { trackOpen } = require("./_redis");
const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

// Hard-bot IP prefixes — these are scanner bots, NOT Gmail image proxy.
// Safe to return 204 because they don't affect Gmail's client-side caching.
function isHardBotIp(ip) {
  return /^17\./.test(ip)         ||  // Apple MPP
         /^66\.249\./.test(ip)    ||  // Google scanner / Googlebot
         /^66\.102\./.test(ip)    ||  // Google image scanner
         /^40\.94\./.test(ip)     ||  // Microsoft SafeLinks
         /^40\.107\./.test(ip)    ||  // Microsoft SafeLinks
         /^52\.100\./.test(ip)    ||  // Microsoft SafeLinks
         /^104\.47\./.test(ip)    ||  // Microsoft email scanner
         /^172\.253\./.test(ip)   ||  // Google SafeBrowsing
         /^130\.211\./.test(ip)   ||  // Google Cloud scanner
         /^35\.190\./.test(ip)    ||  // Google Cloud scanner
         /^23\.21\./.test(ip)     ||  // Amazon SES scanner
         /^54\.240\./.test(ip);       // Amazon SES scanner
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const { id, cid } = req.query;

  if (!id) {
    // No lead ID — just serve a pixel
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    return res.redirect(302, `${APP_URL}/api/track-pixel?t=${token}`);
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
             || req.headers["x-real-ip"]
             || "unknown";
  const ua = req.headers["user-agent"] || "unknown";

  console.log(`🔍 [OPEN] Lead:${id} Camp:${cid || '—'} IP:${ip} UA:${ua.slice(0, 80)}`);

  // Hard-bot IPs: return 204 — these are NOT Gmail's image proxy so they don't
  // affect what Gmail caches on the client side. Saves bandwidth.
  if (isHardBotIp(ip)) {
    console.log(`🤖 [BOT-BLOCK] Hard-bot IP blocked for lead ${id} IP:${ip} — returning 204`);
    // Still log to DB via trackOpen so it appears greyed-out in the UI
    trackOpen(id, ip, ua, cid || null).catch(() => {});
    return res.status(204).end();
  }

  // All other IPs (including Gmail proxy 74.125.x within the 5s guard):
  // Run through full tracking logic, then ALWAYS return 302 to unique URL.
  // This ensures Gmail never caches a "no image" state for our source URL.
  let result = { counted: false, reason: 'error', count: 0 };
  try {
    result = await trackOpen(id, ip, ua, cid || null);
    console.log(result.counted
      ? `✅ [OPEN] Counted lead ${id}, total: ${result.count}`
      : `⏭️  [OPEN] Skipped (${result.reason})`);
  } catch (e) {
    console.error(`❌ [OPEN] Lead ${id}:`, e.message);
  }

  if (!result.counted) {
    console.log(`📭 [OPEN] Not counted (${result.reason}) — returning 302 unique URL so Gmail re-fetches on next open`);
  }

  // Always 302 → unique token URL. Gmail caches at the token URL (destination),
  // not at our source URL, so every new open hits our server fresh.
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
  return res.redirect(302, `${APP_URL}/api/track-pixel?t=${token}`);
};
