// Simple ping endpoint to test if API functions work at all
module.exports = async (req, res) => {
  console.log(`🏓 [PING] ${req.method} ${req.url}`);
  
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  // Test environment variables without database
  const envCheck = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    APP_URL: process.env.APP_URL,
    CRM_PIN: !!process.env.CRM_PIN,
    NODE_ENV: process.env.NODE_ENV || 'development'
  };
  
  res.json({
    success: true,
    message: "Ping successful - API functions are working",
    timestamp: new Date().toISOString(),
    environment: envCheck,
    vercel: {
      region: process.env.VERCEL_REGION || 'unknown',
      deployment: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'unknown'
    }
  });
};