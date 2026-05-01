const { trackOpen } = require("./_redis");

const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

module.exports = async (req, res) => {
  const { id, cid } = req.query;

  // 302 redirect to the actual pixel — this is the key to multiple-open tracking.
  // Gmail caches only the redirect TARGET (the static GIF), not the 302 itself.
  // HTTP spec says 302 is not cacheable, so Gmail must re-request this URL on
  // every open. Each request hits our server and we record a new open event.
  // Serving a 200 directly causes Gmail to cache the response and never re-fetch.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.redirect(302, `${APP_URL}/api/track-pixel`);

  if (!id) return;

  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
               || req.headers["x-real-ip"]
               || "unknown";
    const ua = req.headers["user-agent"] || "unknown";

    console.log(`🔍 [OPEN] Lead:${id} Campaign:${cid||'—'} IP:${ip} UA:${ua.slice(0,80)}`);

    // No UA bot-filter here — Gmail always sends the pixel through Google Image
    // Proxy (UA contains "Googlebot"), so a UA check would block all Gmail opens.
    // The timing guard in trackOpen (15s window after send) is the sole defense
    // against pre-fetch bots. After 15s any request is counted as a real open.
    const result = await trackOpen(id, ip, ua, cid || null);
    console.log(result.counted
      ? `✅ [OPEN] Counted lead ${id}, total: ${result.count}`
      : `⏭️  [OPEN] Skipped lead ${id} (${result.reason})`);
  } catch (e) {
    console.error(`❌ [OPEN] Lead ${id}:`, e.message);
  }
};
