// api/track-open.js
const { trackOpen, logEvent, getDb, ensureTable } = require("./_redis");

// 1×1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function isDeliveryPrefetch(ip) {
  return /^66\.249\./.test(ip || "");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "image/gif");

  const { id, cid } = req.query;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
             || req.headers["x-real-ip"]
             || "unknown";
  const ua = req.headers["user-agent"] || "unknown";

  console.log(`📥 [PIXEL HIT] Lead:${id||'?'} Camp:${cid||'—'} IP:${ip} UA:${ua.slice(0, 100)}`);

  if (id) {
    try {
      // Log ALL hits (including delivery scans) so we can see what Gmail sends us
      await ensureTable();
      const sql = getDb();
      const eventType = isDeliveryPrefetch(ip) ? 'delivery_scan' : 'open';

      if (isDeliveryPrefetch(ip)) {
        // Record delivery scan separately — don't count as open
        await sql`
          INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, campaign_id, created_at)
          VALUES (${id}, 'delivery_scan', ${ip}, ${ua}, ${'scan'}, ${cid || null}, ${Date.now()})
        `.catch(e => console.error('delivery_scan log failed:', e.message));
        console.log(`🚚 [DELIVERY SCAN] Logged (not counted) lead:${id} ip:${ip}`);
      } else {
        // Real hit — run full tracking logic
        const result = await trackOpen(id, ip, ua, cid || null);
        console.log(result.counted
          ? `✅ [OPEN] Counted lead ${id} total:${result.count} ip:${ip}`
          : `⏭️  [OPEN] Skipped lead ${id} reason:${result.reason} ip:${ip}`);
      }
    } catch (e) {
      console.error(`❌ [OPEN] Lead ${id}:`, e.message);
    }
  }

  res.send(PIXEL);
};
