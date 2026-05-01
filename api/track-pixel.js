// Serves the actual 1x1 tracking GIF — cacheable static endpoint.
// track-open redirects here (302) so Gmail must re-request track-open on each
// open while caching only this static pixel content.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

module.exports = (req, res) => {
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(PIXEL);
};
