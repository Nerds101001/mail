const { trackOpen } = require("./_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

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

module.exports = async (req, res) => {
  try {
    // Always return pixel headers first
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const { id, cid } = req.query;

    // Return pixel immediately
    res.send(PIXEL);

    // Do tracking asynchronously after response is sent
    if (id) {
      setImmediate(async () => {
        try {
          const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || 
                     req.headers["x-real-ip"] || 
                     "unknown";
          const ua = req.headers["user-agent"] || "unknown";

          console.log(`🔍 [TRACK OPEN] Lead ID: ${id}, IP: ${ip}, UA: ${ua.substring(0, 50)}...`);

          // Filter out bots and prefetchers
          if (isLikelyBot(ua)) {
            console.log(`🤖 [TRACK OPEN] Bot/Prefetch detected, skipping count for ${id}`);
            return;
          }

          // Use deduplicated tracking (only counts unique opens within time window)
          const result = await trackOpen(id, ip, ua, cid);
          
          if (result.counted) {
            console.log(`✅ [TRACK OPEN] Real open counted - Lead ${id}, Total: ${result.count}`);
          } else {
            console.log(`⏭️ [TRACK OPEN] Duplicate open ignored - Lead ${id} (within ${result.reason})`);
          }

        } catch(e) {
          console.error(`❌ [TRACK OPEN ERROR] Lead ${id}:`, e.message, e.stack);
        }
      });
    }

  } catch (error) {
    console.error(`❌ [TRACK OPEN FATAL] Error:`, error.message);
    // If everything fails, still try to return a pixel
    try {
      res.setHeader("Content-Type", "image/gif");
      res.send(PIXEL);
    } catch (e) {
      res.status(500).json({ error: error.message });
    }
  }
};
