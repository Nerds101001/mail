const { trackClick } = require("./_redis");

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

module.exports = async (req, res) => {
  // Parse lead + campaign IDs + destination URL from path or query
  let { id, url, cid } = req.query;

  if (!id && req.url) {
    // Format: /api/track/click/leadId/campaignId/encodedUrl  OR  /leadId/encodedUrl
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

  res.setHeader("Access-Control-Allow-Origin", "*");

  // Redirect immediately — tracking runs after but before function returns
  res.redirect(302, redirectUrl);

  if (!id) return;

  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
               || req.headers["x-real-ip"]
               || req.connection?.remoteAddress
               || "unknown";
    const ua = req.headers["user-agent"] || "unknown";

    console.log(`🔗 [CLICK] Lead:${id} Campaign:${cid||'—'} IP:${ip} URL:${decoded.slice(0,60)}`);

    if (isLikelyBot(ua)) {
      console.log(`🤖 [CLICK] Bot UA, skipping`);
      return;
    }

    const result = await trackClick(id, ip, ua, decoded, cid || null);
    console.log(result.counted
      ? `✅ [CLICK] Counted lead ${id}, total: ${result.count}`
      : `⏭️  [CLICK] Skipped lead ${id} (${result.reason})`);
  } catch (e) {
    console.error(`❌ [CLICK] Lead ${id}:`, e.message);
  }
};
