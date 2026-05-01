const { trackOpen } = require("./_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const BOT_PATTERNS = [
  /bot\b/i, /crawler/i, /spider/i, /scraper/i,
  // NOTE: googleimageproxy intentionally excluded — Gmail always fetches tracking
  // pixels through its proxy (both pre-fetch AND real user opens). Blocking it
  // by UA would block all Gmail opens. We rely on the 15s timing guard instead.
  /outlooksafelinks/i, /safelinks\.protection/i,
  /barracuda/i, /mimecast/i, /proofpoint/i, /ironport/i,
  /mailscanner/i, /spamassassin/i,
  /headlesschrome/i, /phantomjs/i, /selenium/i, /puppeteer/i, /playwright/i,
  /^curl\//i, /^wget\//i, /^python-requests/i, /^go-http-client/i,
  /^okhttp/i, /^java\//i, /^libwww/i, /^lwp-/i,
  /link.*check/i, /url.*check/i, /link.*validator/i,
  /preview/i, /prerender/i, /prefetch/i,
];

function isLikelyBot(ua) {
  if (!ua || ua === 'unknown') return true;
  return BOT_PATTERNS.some(p => p.test(ua));
}

module.exports = async (req, res) => {
  // Always set pixel headers
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Parse lead + campaign IDs from path or query
  let { id, cid } = req.query;
  if (!id && req.url) {
    const m = req.url.match(/\/api\/track\/open\/([^\/\?]+)(?:\/([^\/\?]+))?/);
    if (m) { id = m[1]; cid = m[2]; }
  }

  // Send pixel immediately — client gets it without waiting for DB writes
  res.send(PIXEL);

  // Tracking runs after response is sent but BEFORE the function returns,
  // so Vercel keeps the process alive until we finish (setImmediate was wrong
  // because Vercel freezes the process as soon as the exported function resolves).
  if (!id) return;

  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
               || req.headers["x-real-ip"]
               || "unknown";
    const ua = req.headers["user-agent"] || "unknown";

    console.log(`🔍 [OPEN] Lead:${id} Campaign:${cid||'—'} IP:${ip} UA:${ua.slice(0,80)}`);

    if (isLikelyBot(ua)) {
      console.log(`🤖 [OPEN] Bot UA, skipping`);
      return;
    }

    const result = await trackOpen(id, ip, ua, cid || null);
    console.log(result.counted
      ? `✅ [OPEN] Counted lead ${id}, total: ${result.count}`
      : `⏭️  [OPEN] Skipped lead ${id} (${result.reason})`);
  } catch (e) {
    console.error(`❌ [OPEN] Lead ${id}:`, e.message);
  }
};
