const { trackOpen } = require("./_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { id, cid } = req.query;

  // Send pixel immediately
  res.send(PIXEL);

  if (!id) return;

  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
               || req.headers["x-real-ip"]
               || "unknown";
    const ua = req.headers["user-agent"] || "unknown";

    console.log(`🔍 [OPEN] Lead:${id} Campaign:${cid||'—'} IP:${ip} UA:${ua.slice(0,80)}`);

    // No UA bot-filter here — Gmail always sends the pixel through Google Image
    // Proxy (UA contains "Googlebot"), so a UA check would block all Gmail opens.
    // The timing guard in trackOpen (15s window after send) is the sole defense
    // against pre-fetch bots. After 15s any request is counted as a real open.
    const result = await trackOpen(id, ip, ua, cid || null);
    console.log(result.counted
      ? `✅ [OPEN] Counted lead ${id}, total: ${result.count}`
      : `⏭️  [OPEN] Skipped lead ${id} (${result.reason})`);
  } catch (e) {
    console.error(`❌ [OPEN] Lead ${id}:`, e.message);
  }
};
