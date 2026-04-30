const { trackClick } = require("./_redis");

// Bot/Prefetch detection patterns - ENHANCED
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

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

module.exports = async (req, res) => {
  // Support both query params (?id=X&url=Y&cid=Z) and path params (/api/track/click/leadId/campaignId/url)
  let { id, url, cid } = req.query;
  
  // If no query params, try to parse from path
  if (!id && req.url) {
    const pathMatch = req.url.match(/\/api\/track\/click\/([^\/]+)\/([^\/]+)\/(.+)/);
    if (pathMatch) {
      id = pathMatch[1];
      // Check if second param is a campaign ID or URL
      if (pathMatch[2].startsWith('camp_')) {
        cid = pathMatch[2];
        url = pathMatch[3];
      } else {
        url = pathMatch[2] + '/' + pathMatch[3];
      }
    } else {
      // Try simpler format without campaign ID
      const simpleMatch = req.url.match(/\/api\/track\/click\/([^\/]+)\/(.+)/);
      if (simpleMatch) {
        id = simpleMatch[1];
        url = simpleMatch[2];
      }
    }
  }
  
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

        console.log(`🔗 [TRACK CLICK] ========================================`);
        console.log(`🔗 [TRACK CLICK] Lead ID: ${id}`);
        console.log(`🔗 [TRACK CLICK] Target URL: ${decoded}`);
        console.log(`🔗 [TRACK CLICK] IP: ${ip}`);
        console.log(`🔗 [TRACK CLICK] User Agent: ${ua}`);
        console.log(`🔗 [TRACK CLICK] Campaign ID: ${cid || 'none'}`);
        console.log(`🔗 [TRACK CLICK] URL: ${req.url}`);
        console.log(`🔗 [TRACK CLICK] ========================================`);

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
