// api/tracking.js — Consolidated tracking endpoints (open, click, pixel)
const { trackOpen, trackClick } = require("./_redis");

const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

// Bot detection patterns
const BOT_PATTERNS = [
  /bot\b/i, /crawler/i, /spider/i, /scraper/i,
  /googleimageproxy/i, /outlooksafelinks/i, /safelinks\.protection/i,
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

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

// 1x1 tracking pixel
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

module.exports = async (req, res) => {
  const { type } = req.query;
  res.setHeader("Access-Control-Allow-Origin", "*");

  // ── PIXEL ENDPOINT ────────────────────────────────────────────────────
  if (type === 'pixel') {
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(PIXEL);
  }

  // ── OPEN TRACKING ─────────────────────────────────────────────────────
  if (type === 'open') {
    const { id, cid } = req.query;

    // Run tracking BEFORE redirect so Vercel doesn't terminate function early
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

    // no-store prevents Gmail proxy from caching this 302 — forces a new request on each open
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    return res.redirect(302, `${APP_URL}/api/tracking?type=pixel&t=${token}`);
  }

  // ── CLICK TRACKING ────────────────────────────────────────────────────
  if (type === 'click') {
    let { id, url, cid } = req.query;

    if (!id && req.url) {
      // Format: /api/tracking?type=click&id=leadId&url=encodedUrl&cid=campaignId
      // Or path-based: /api/track/click/leadId/campaignId/encodedUrl
      const m3 = req.url.match(/\/api\/track\/click\/([^\/]+)\/([^\/]+)\/(.+)/);
      if (m3) {
        id = m3[1];
        if (m3[2].startsWith('camp_')) { cid = m3[2]; url = m3[3]; }
        else                            { url = m3[2] + '/' + m3[3]; }
      } else {
        const m2 = req.url.match(/\/api\/track\/click\/([^\/]+)\/(.+)/);
        if (m2) { id = m2[1]; url = m2[2]; }
      }
    }

    const decoded     = decodeURIComponent(url || "");
    const redirectUrl = (decoded && isSafeUrl(decoded)) ? decoded : "https://enginerds.in";

    // Run tracking BEFORE redirect
    if (id) {
      try {
        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
                   || req.headers["x-real-ip"]
                   || req.connection?.remoteAddress
                   || "unknown";
        const ua = req.headers["user-agent"] || "unknown";

        console.log(`🔗 [CLICK] Lead:${id} Campaign:${cid||'—'} IP:${ip} URL:${decoded.slice(0,60)}`);

        if (!isLikelyBot(ua)) {
          const result = await trackClick(id, ip, ua, decoded, cid || null);
          console.log(result.counted
            ? `✅ [CLICK] Counted lead ${id}, total: ${result.count}`
            : `⏭️  [CLICK] Skipped lead ${id} (${result.reason})`);
        } else {
          console.log(`🤖 [CLICK] Bot UA, skipping`);
        }
      } catch (e) {
        console.error(`❌ [CLICK] Lead ${id}:`, e.message);
      }
    }

    return res.redirect(302, redirectUrl);
  }

  // ── DEFAULT ───────────────────────────────────────────────────────────
  res.status(400).json({ error: "Invalid tracking type. Use ?type=open, ?type=click, or ?type=pixel" });
};