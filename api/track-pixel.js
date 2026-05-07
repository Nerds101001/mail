// api/track-pixel.js — Serves 1x1 tracking pixel GIF

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.send(PIXEL);
};
