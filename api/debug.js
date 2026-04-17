// Debug endpoint to check what's causing 401 errors
module.exports = async (req, res) => {
  console.log(`🔍 [DEBUG] ${req.method} ${req.url}`);
  console.log(`🔍 [DEBUG] Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`🔍 [DEBUG] Query:`, req.query);
  
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  try {
    // Check environment variables
    const envCheck = {
      DATABASE_URL: !!process.env.DATABASE_URL,
      POSTGRES_URL: !!process.env.POSTGRES_URL,
      APP_URL: process.env.APP_URL,
      CRM_PIN: !!process.env.CRM_PIN,
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID
    };
    
    console.log(`🔍 [DEBUG] Environment check:`, envCheck);
    
    // Test database connection
    const { ensureTable } = require("./_redis");
    await ensureTable();
    console.log(`✅ [DEBUG] Database connection successful`);
    
    res.json({
      success: true,
      message: "Debug endpoint working",
      timestamp: new Date().toISOString(),
      environment: envCheck,
      method: req.method,
      url: req.url,
      query: req.query
    });
    
  } catch (error) {
    console.error(`❌ [DEBUG] Error:`, error.message);
    console.error(`❌ [DEBUG] Stack:`, error.stack);
    
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
};