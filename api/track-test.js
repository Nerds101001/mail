// Isolated tracking test - no database, no imports
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  try {
    console.log(`🧪 [TRACK TEST] ${req.method} ${req.url}`);
    console.log(`🧪 [TRACK TEST] Query:`, req.query);
    
    // Set headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    
    const { id, type } = req.query;
    
    // Test pixel endpoint
    if (type === "pixel") {
      res.setHeader("Content-Type", "image/gif");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      console.log(`🧪 [TRACK TEST] Returning pixel for ID: ${id}`);
      return res.send(PIXEL);
    }
    
    // Test JSON endpoint
    res.setHeader("Content-Type", "application/json");
    const response = {
      success: true,
      message: "Tracking test endpoint working",
      timestamp: new Date().toISOString(),
      leadId: id || "none",
      environment: {
        DATABASE_URL: !!process.env.DATABASE_URL,
        APP_URL: process.env.APP_URL,
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: process.env.VERCEL
      }
    };
    
    console.log(`🧪 [TRACK TEST] Returning JSON:`, response);
    res.status(200).json(response);
    
  } catch (error) {
    console.error(`❌ [TRACK TEST] Error:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};