// api/track-open.js
// Gmail caching reality (from Litmus, Prospeo, gblock research 2024-2026):
//   - Gmail Image Proxy pre-fetches all images at delivery from 66.249.x.x IPs
//   - Subsequent opens of the same email on GMAIL WEB DESKTOP serve from Google's
//     cache — our server never sees a second request. This is Gmail's design and
//     cannot be bypassed by any server-side technique (headers, 302, etc.).
//   - Gmail MOBILE, Outlook, Apple Mail (no MPP), and other clients DO re-fetch
//     on each open — multiple opens track correctly for those clients.
//
// Strategy:
//   1. Return 302 → unique pixel URL (best attempt at preventing cache reuse)
//   2. Known email proxy IPs (Google/Apple) bypass the 15s timing guard —
//      their pre-fetch is the only open signal we'll ever get from Gmail desktop
//   3. 2-minute IP+campaign dedup prevents counting one load twice

const { trackOpen } = require("./_redis");
const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { id, cid } = req.query;

  // Redirect to a unique pixel URL on every request.
  // Unique token = Gmail cannot reuse a cached response from a previous open
  // because the redirect target URL changes each time.
  // 302 (not 301/200) = by HTTP spec, not permanently cacheable.
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
  res.redirect(302, `${APP_URL}/api/track-pixel?t=${token}`);

  // Tracking runs after redirect is sent — Vercel keeps function alive until
  // this async function resolves (we must await, not fire-and-forget).
  if (!id) return;

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
};
