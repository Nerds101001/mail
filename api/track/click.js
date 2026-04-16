// api/track/click.js — Email click tracking redirect
// GET /api/track/click?id=LEAD_ID&url=TARGET_URL
// Increments click counter, redirects to real URL

const { incr } = require("../_redis");

function isSafeUrl(urlString) {
  try {
    const u = new URL(urlString);
    return ["http:", "https:"].includes(u.protocol);
  } catch { return false; }
}

module.exports = async (req, res) => {
  const { id, url } = req.query;
  const decoded = decodeURIComponent(url || "");

  // Redirect immediately — never block on DB
  if (decoded && isSafeUrl(decoded)) {
    res.redirect(302, decoded);
  } else {
    res.redirect(302, "https://enginerds.in");
  }

  // Increment AFTER redirect — fire and forget
  if (id) {
    incr(`track:click:${id}`).catch(e => console.error("Click track error:", e.message));
  }
};
