const { incr, logEvent, getDb } = require("./_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  const { id, cid } = req.query; // id=leadId, cid=campaignId

  if (id) {
    try {
      const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.headers["x-real-ip"] || "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      const tasks = [
        incr(`track:open:${id}`).catch(() => {}),
        logEvent({ lead_id: id, event_type: "open", ip, user_agent: ua }).catch(() => {}),
      ];

      // If campaign ID exists, increment campaign-specific open count
      if (cid) {
        const sql = getDb();
        tasks.push(
          sql`UPDATE campaign_leads SET opens = opens + 1, status = 'opened', last_open = ${Date.now()} WHERE campaign_id = ${cid} AND lead_id = ${id}`.catch(() => {}),
          sql`UPDATE campaigns SET stats = jsonb_set(COALESCE(stats, '{}'::jsonb), '{opens}', (COALESCE(stats->>'opens','0')::int + 1)::text::jsonb) WHERE id = ${cid}`.catch(() => {})
        );
      }

      await Promise.all(tasks);
    } catch(e) {
      console.error("Open track error:", e.message);
    }
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(PIXEL);
};
