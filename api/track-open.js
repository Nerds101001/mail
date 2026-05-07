// api/track-open.js — Email open tracking pixel
const { trackOpen } = require("./_redis");

const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

module.exports = async (req, res) => {
  const { id, cid } = req.query;

  // Run tracking BEFORE redirect so Vercel doesn't terminate function early
  if (id) {
    try {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
                 || req.headers["x-real-ip"]
                 || "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      console.log(`🔍 [OPEN] Lead:${id} Camp:${cid||'—'} IP:${ip} UA:${ua.slice(0, 80)}`);

      const result = await trackOpen(id, ip, ua, cid || null);
      console.log(result.counted
        ? `✅ [OPEN] Counted lead ${id}, total: ${result.count}`
        : `⏭️  [OPEN] Skipped (${result.reason})`);
    } catch (e) {
      console.error(`❌ [OPEN] Lead ${id}:`, e.message);
    }
  }

  // no-store prevents Gmail proxy from caching this 302 — forces a new request on each open
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
  return res.redirect(302, `${APP_URL}/api/track-pixel?t=${token}`);
};
