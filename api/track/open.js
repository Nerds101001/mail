// api/track/open.js — Email open tracking pixel
// GET /api/track/open?id=LEAD_ID
// Returns 1x1 transparent GIF, increments open counter

const { incr } = require("../_redis");

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  const { id } = req.query;

  // Always return pixel immediately — never block on DB
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(PIXEL);

  // Increment AFTER sending response — fire and forget
  if (id) {
    incr(`track:open:${id}`).catch(e => console.error("Open track error:", e.message));
  }
};
