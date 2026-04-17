// Minimal test endpoint - no imports, no database
module.exports = async (req, res) => {
  // Set headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  // Simple response without any imports
  res.status(200).json({
    success: true,
    message: "Simple test working",
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    query: req.query,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      DATABASE_URL_EXISTS: !!process.env.DATABASE_URL
    }
  });
};