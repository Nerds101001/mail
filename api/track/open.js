// api/track/open.js
// Called when a recipient opens the email (their client loads the tracking pixel)
// Increments the open counter in Redis and returns a 1x1 transparent GIF
//
// GET /api/track/open?id=LEAD_ID

const { incr } = require("../_redis");

// Smallest possible transparent GIF (1x1 pixel) — 43 bytes
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

module.exports = async (req, res) => {
  const { id } = req.query;

  if (id) {
    try {
      // Atomically increment open count for this lead
      await incr(`track:open:${id}`);
    } catch (err) {
      // Never fail a tracking request — silently ignore errors
      console.error("Open track error:", err.message);
    }
  }

  // Always return the pixel image regardless of errors
  // This ensures email clients don't show a broken image
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.send(PIXEL);
};
