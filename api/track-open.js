const { trackOpen } = require("./_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// Bot/Prefetch detection patterns - ENHANCED
const BOT_PATTERNS = [
  // Explicit bots / crawlers
  /bot\b/i, /crawler/i, /spider/i, /scraper/i,
  // Email security scanners that pre-fetch
  /googleimageproxy/i, /outlooksafelinks/i, /safelinks\.protection/i,
  /barracuda/i, /mimecast/i, /proofpoint/i, /ironport/i,
  /mailscanner/i, /spamassassin/i,
  // Headless / automation
  /headlesschrome/i, /phantomjs/i, /selenium/i, /puppeteer/i, /playwright/i,
  // CLI tools
  /^curl\//i, /^wget\//i, /^python-requests/i, /^go-http-client/i,
  /^okhttp/i, /^java\//i, /^libwww/i, /^lwp-/i,
  // Link checkers
  /link.*check/i, /url.*check/i, /link.*validator/i,
  // Preview / prefetch services
  /preview/i, /prerender/i, /prefetch/i,
];

function isLikelyBot(userAgent) {
  if (!userAgent || userAgent === 'unknown') {
    console.log(`🤖 [BOT CHECK] No user agent - treating as bot`);
    return true;
  }
  
  const isBot = BOT_PATTERNS.some(pattern => pattern.test(userAgent));
  
  if (isBot) {
    console.log(`🤖 [BOT CHECK] Bot detected: ${userAgent.substring(0, 100)}`);
  } else {
    console.log(`✅ [BOT CHECK] Real user: ${userAgent.substring(0, 100)}`);
  }
  
  return isBot;
}

module.exports = async (req, res) => {
  try {
    // Always return pixel headers first
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Support both query params (?id=X&cid=Y) and path params (/api/track/open/leadId/campaignId)
    let { id, cid } = req.query;
    
    // If no query params, try to parse from path
    if (!id && req.url) {
      const pathMatch = req.url.match(/\/api\/track\/open\/([^\/\?]+)(?:\/([^\/\?]+))?/);
      if (pathMatch) {
        id = pathMatch[1];
        cid = pathMatch[2];
      }
    }

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

          console.log(`🔍 [TRACK OPEN] ========================================`);
          console.log(`🔍 [TRACK OPEN] Lead ID: ${id}`);
          console.log(`🔍 [TRACK OPEN] IP: ${ip}`);
          console.log(`🔍 [TRACK OPEN] User Agent: ${ua}`);
          console.log(`🔍 [TRACK OPEN] Campaign ID: ${cid || 'none'}`);
          console.log(`🔍 [TRACK OPEN] URL: ${req.url}`);
          console.log(`🔍 [TRACK OPEN] ========================================`);

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
