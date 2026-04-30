const { trackClick } = require("./_redis");

// Bot/Prefetch detection patterns
const BOT_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i,
  /prerender/i, /preview/i, /prefetch/i,
  /googleimageproxy/i, /outlooksafelinks/i,
  /mailscanner/i, /antivirus/i, /security/i
];

function isLikelyBot(userAgent) {
  if (!userAgent || userAgent === 'unknown') return true;
  return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
}

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

module.exports = async (req, res) => {
  const { id, url, cid } = req.query;
  const decoded = decodeURIComponent(url || "");

  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Always redirect first, then do tracking
  const redirectUrl = (decoded && isSafeUrl(decoded)) ? decoded : "https://enginerds.in";
  
  // Redirect immediately
  res.redirect(302, redirectUrl);

  // Do tracking asynchronously after redirect
  if (id) {
    setImmediate(async () => {
      try {
        const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || 
                   req.headers["x-real-ip"] || 
                   req.connection?.remoteAddress || 
                   "unknown";
        const ua = req.headers["user-agent"] || "unknown";

        console.log(`🔗 [TRACK CLICK] Lead ID: ${id}, URL: ${decoded}, IP: ${ip}, UA: ${ua.substring(0, 50)}...`);

        // Filter out bots
        if (isLikelyBot(ua)) {
          console.log(`🤖 [TRACK CLICK] Bot detected, skipping count for ${id}`);
          return;
        }

        // Use deduplicated tracking
        const result = await trackClick(id, ip, ua, decoded, cid);
        
        if (result.counted) {
          console.log(`✅ [TRACK CLICK] Real click counted - Lead ${id}, Total: ${result.count}`);
        } else {
          console.log(`⏭️ [TRACK CLICK] Duplicate click ignored - Lead ${id} (within ${result.reason})`);
        }

      } catch(e) {
        console.error(`❌ [TRACK CLICK ERROR] Lead ${id}:`, e.message);
      }
    });
  }
};
