// Ultra-simple tracking test - no database, just logging
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  const { id } = req.query;
  
  console.log(`🧪 [BASIC TEST] Tracking pixel requested for ID: ${id}`);
  console.log(`🧪 [BASIC TEST] Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`🧪 [BASIC TEST] Query:`, req.query);
  
  // Set headers
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  // Return pixel
  res.send(PIXEL);
  
  console.log(`✅ [BASIC TEST] Pixel sent successfully for ID: ${id}`);
};