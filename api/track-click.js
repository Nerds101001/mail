const { incr, logEvent, getDb } = require("./_redis");

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

module.exports = async (req, res) => {
  const { id, url, cid } = req.query;
  const decoded = decodeURIComponent(url || "");

  if (id) {
    try {
      const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || 
                 req.headers["x-real-ip"] || 
                 req.connection?.remoteAddress || 
                 "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      console.log(`🔗 [TRACK CLICK] Lead ID: ${id}, URL: ${decoded}, IP: ${ip}, UA: ${ua.substring(0, 50)}...`);

      // Run tracking operations in parallel but don't block redirect
      const trackingPromises = [
        incr(`track:click:${id}`).catch(e => console.error("Click counter increment failed:", e.message)),
        logEvent({ lead_id: id, event_type: "click", ip, user_agent: ua, target_url: decoded }).catch(e => console.error("Click event logging failed:", e.message))
      ];

      // Campaign specific click tracking
      if (cid) {
        const sql = getDb();
        trackingPromises.push(
          sql`UPDATE campaign_leads SET 
                clicks = clicks + 1, 
                status = CASE WHEN status IN ('sent', 'opened') THEN 'clicked' ELSE status END,
                last_click = ${Date.now()} 
              WHERE campaign_id = ${cid} AND lead_id = ${id}`
            .catch(e => console.error("Campaign click update failed:", e.message)),
          
          sql`UPDATE campaigns SET 
                stats = jsonb_set(
                  COALESCE(stats, '{}'::jsonb), 
                  '{clicks}', 
                  (COALESCE(stats->>'clicks','0')::int + 1)::text::jsonb
                ) 
              WHERE id = ${cid}`
            .catch(e => console.error("Campaign click stats failed:", e.message))
        );
      }

      // Execute tracking but don't wait for completion
      Promise.all(trackingPromises).then(() => {
        console.log(`✅ [TRACK CLICK SUCCESS] Lead ${id} click tracking completed`);
      }).catch(e => {
        console.error(`❌ [TRACK CLICK ERROR] Lead ${id}:`, e.message);
      });

    } catch(e) {
      console.error(`❌ [TRACK CLICK CRITICAL] Lead ${id}:`, e.message);
    }
  }

  // Always redirect, even if tracking fails
  if (decoded && isSafeUrl(decoded)) {
    res.redirect(302, decoded);
  } else {
    console.warn(`⚠️ [UNSAFE URL] Redirecting to fallback: ${decoded}`);
    res.redirect(302, "https://enginerds.in");
  }
};
