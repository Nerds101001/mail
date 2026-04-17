// Simple ping endpoint to test if API functions work at all
module.exports = async (req, res) => {
  try {
    console.log(`🏓 [PING] ${req.method} ${req.url}`);
    console.log(`🏓 [PING] Headers:`, JSON.stringify(req.headers, null, 2));
    
    // Set CORS headers first
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    
    if (req.method === "OPTIONS") {
      console.log(`🏓 [PING] OPTIONS request handled`);
      return res.status(200).end();
    }
    
    // Test environment variables without database
    const envCheck = {
      DATABASE_URL: !!process.env.DATABASE_URL,
      APP_URL: process.env.APP_URL,
      CRM_PIN: !!process.env.CRM_PIN,
      NODE_ENV: process.env.NODE_ENV || 'development',
      VERCEL: !!process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV
    };
    
    console.log(`🏓 [PING] Environment check:`, envCheck);
    
    const response = {
      success: true,
      message: "Ping successful - API functions are working",
      timestamp: new Date().toISOString(),
      environment: envCheck,
      vercel: {
        region: process.env.VERCEL_REGION || 'unknown',
        deployment: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'unknown',
        url: process.env.VERCEL_URL || 'unknown'
      },
      request: {
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'] || 'unknown'
      }
    };
    
    console.log(`🏓 [PING] Sending response:`, response);
    res.status(200).json(response);
    
  } catch (error) {
    console.error(`❌ [PING] Error:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
};