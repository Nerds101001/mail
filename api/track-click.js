const { incr, logEvent } = require("./_redis");

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

        // Use simplified tracking system
        const clickCount = await incr(`track:click:${id}`);
        await logEvent({ 
          lead_id: id, 
          event_type: "click", 
          ip, 
          user_agent: ua, 
          target_url: decoded 
        });

        console.log(`✅ [TRACK CLICK SUCCESS] Lead ${id} - Click count: ${clickCount}`);

      } catch(e) {
        console.error(`❌ [TRACK CLICK ERROR] Lead ${id}:`, e.message);
      }
    });
  }
};
