const { incr, logEvent, getDb } = require("./_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  // Always return pixel headers first - don't wait for anything
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { id, cid } = req.query; // id=leadId, cid=campaignId

  // Return pixel immediately, then do tracking in background
  res.send(PIXEL);

  // Do tracking asynchronously after response is sent
  if (id) {
    setImmediate(async () => {
      try {
        const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || 
                   req.headers["x-real-ip"] || 
                   req.connection?.remoteAddress || 
                   "unknown";
        const ua = req.headers["user-agent"] || "unknown";

        console.log(`🔍 [TRACK OPEN] Lead ID: ${id}, IP: ${ip}, UA: ${ua.substring(0, 50)}...`);

        // Run tracking operations but don't block
        const trackingPromises = [
          incr(`track:open:${id}`).catch(e => console.error("Counter increment failed:", e.message)),
          logEvent({ lead_id: id, event_type: "open", ip, user_agent: ua }).catch(e => console.error("Event logging failed:", e.message))
        ];

        // If campaign ID exists, update campaign-specific stats
        if (cid) {
          const sql = getDb();
          trackingPromises.push(
            sql`UPDATE campaign_leads SET 
                  opens = opens + 1, 
                  status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END,
                  last_open = ${Date.now()} 
                WHERE campaign_id = ${cid} AND lead_id = ${id}`
              .catch(e => console.error("Campaign lead update failed:", e.message)),
            
            sql`UPDATE campaigns SET 
                  stats = jsonb_set(
                    COALESCE(stats, '{}'::jsonb), 
                    '{opens}', 
                    (COALESCE(stats->>'opens','0')::int + 1)::text::jsonb
                  ) 
                WHERE id = ${cid}`
              .catch(e => console.error("Campaign stats update failed:", e.message))
          );
        }

        // Execute all tracking operations
        await Promise.all(trackingPromises);
        console.log(`✅ [TRACK OPEN SUCCESS] Lead ${id} tracking completed`);

      } catch(e) {
        console.error(`❌ [TRACK OPEN CRITICAL] Lead ${id}:`, e.message);
      }
    });
  }
};
