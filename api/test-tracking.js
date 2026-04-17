// Simple test endpoint to debug tracking issues
module.exports = async (req, res) => {
  console.log(`🧪 [TEST] Request received: ${req.method} ${req.url}`);
  console.log(`🧪 [TEST] Query params:`, req.query);
  console.log(`🧪 [TEST] Headers:`, req.headers);
  
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  try {
    // Test database connection
    const { ensureTable } = require("./_redis");
    await ensureTable();
    console.log(`✅ [TEST] Database connection successful`);
    
    res.json({
      success: true,
      message: "Test endpoint working",
      timestamp: new Date().toISOString(),
      query: req.query,
      method: req.method
    });
  } catch (error) {
    console.error(`❌ [TEST] Error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};