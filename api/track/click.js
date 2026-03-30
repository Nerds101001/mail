// api/track/click.js
// Called when a recipient clicks a tracked link in the email
// Increments click counter in Redis, then redirects to the real URL
//
// GET /api/track/click?id=LEAD_ID&url=TARGET_URL

const { incr } = require("../_redis");

// Allowed domains for redirect safety (prevents open redirect abuse)
const ALLOWED_DOMAINS = [
  "enginerds.in",
  "www.enginerds.in",
  // Add more trusted domains here
];

function isSafeUrl(urlString) {
  try {
    const url = new URL(urlString);
    // Only allow http/https redirects
    if (!["http:", "https:"].includes(url.protocol)) return false;
    // Only redirect to allowed domains
    return ALLOWED_DOMAINS.some(
      (d) => url.hostname === d || url.hostname.endsWith("." + d)
    );
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  const { id, url } = req.query;

  if (id) {
    try {
      await incr(`track:click:${id}`);
    } catch (err) {
      console.error("Click track error:", err.message);
    }
  }

  // Validate the redirect URL for security
  const decodedUrl = decodeURIComponent(url || "");
  if (!decodedUrl || !isSafeUrl(decodedUrl)) {
    // Fallback to homepage if URL is invalid or not whitelisted
    return res.redirect("https://enginerds.in");
  }

  res.redirect(decodedUrl);
};
