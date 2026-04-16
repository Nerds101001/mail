const { incr, logEvent } = require("../_redis");

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

module.exports = async (req, res) => {
  const { id, url } = req.query;
  const decoded = decodeURIComponent(url || "");

  if (id) {
    try {
      const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.headers["x-real-ip"] || "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      await Promise.all([
        incr(`track:click:${id}`).catch(() => {}),
        logEvent({ lead_id: id, event_type: "click", ip, user_agent: ua, target_url: decoded }).catch(() => {}),
      ]);
    } catch(e) {
      console.error("Click track error:", e.message);
    }
  }

  // Redirect
  if (decoded && isSafeUrl(decoded)) {
    res.redirect(302, decoded);
  } else {
    res.redirect(302, "https://enginerds.in");
  }
};
