// api/tracking.js — Consolidated tracking router and handlers
const { trackOpen, trackClick } = require("./_redis");

const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

// 1x1 transparent GIF for tracking pixel
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

// Handle open tracking
async function handleOpen(req, res) {
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

// Handle click tracking
async function handleClick(req, res) {
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

      const result = await trackClick(id, ip, ua, decoded, cid || null);
      console.log(result.counted
        ? `✅ [CLICK] Counted lead ${id}, total: ${result.count}`
        : `⏭️  [CLICK] Skipped lead ${id} (${result.reason})`);
    } catch (e) {
      console.error(`❌ [CLICK] Lead ${id}:`, e.message);
    }
  }

  return res.redirect(302, redirectUrl);
}

// Handle tracking pixel
async function handlePixel(req, res) {
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.send(PIXEL);
}

// Main tracking router
module.exports = async (req, res) => {
  const { type } = req.query;

  // Handle different tracking types
  switch (type) {
    case 'open':
      return handleOpen(req, res);
      
    case 'click':
      return handleClick(req, res);
      
    case 'pixel':
      return handlePixel(req, res);
      
    default:
      // Invalid or missing type parameter
      console.error(`❌ [TRACKING] Invalid type: ${type}`);
      return res.status(400).json({ error: 'Invalid tracking type' });
  }
};