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
      const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.headers["x-real-ip"] || "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      const tasks = [
        incr(`track:click:${id}`).catch(() => {}),
        logEvent({ lead_id: id, event_type: "click", ip, user_agent: ua, target_url: decoded }).catch(() => {}),
      ];

      // Campaign specific click tracking
      if (cid) {
        const sql = getDb();
        tasks.push(
          sql`UPDATE campaign_leads SET clicks = clicks + 1, last_click = ${Date.now()} WHERE campaign_id = ${cid} AND lead_id = ${id}`.catch(() => {}),
          sql`UPDATE campaigns SET stats = jsonb_set(stats::jsonb, '{clicks}', (COALESCE(stats::jsonb->>'clicks','0')::int + 1)::text::jsonb) WHERE id = ${cid}`.catch(() => {})
        );
      }

      await Promise.all(tasks);
    } catch(e) {
      console.error("Click track error:", e.message);
    }
  }

  if (decoded && isSafeUrl(decoded)) {
    res.redirect(302, decoded);
  } else {
    res.redirect(302, "https://enginerds.in");
  }
};
