// api/track-click.js — Link click tracking and redirect
const { trackClick } = require("./_redis");

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

module.exports = async (req, res) => {
  let { id, url, cid } = req.query;

  if (!id && req.url) {
    // Format: /api/track-click?id=leadId&url=encodedUrl&cid=campaignId
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

      const result = await trackClick(id, ip, ua, decoded, cid || null);
      console.log(result.counted
        ? `✅ [CLICK] Counted lead ${id}, total: ${result.count}`
        : `⏭️  [CLICK] Skipped lead ${id} (${result.reason})`);
    } catch (e) {
      console.error(`❌ [CLICK] Lead ${id}:`, e.message);
    }
  }

  return res.redirect(302, redirectUrl);
};
