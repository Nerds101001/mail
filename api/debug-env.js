// api/debug-env.js — Debug environment variables
module.exports = async (req, res) => {
  try {
    const envVars = {
      CRM_PIN: process.env.CRM_PIN ? "SET" : "NOT SET",
      DATABASE_URL: process.env.DATABASE_URL ? "SET" : "NOT SET",
      APP_URL: process.env.APP_URL || "NOT SET",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? "SET" : "NOT SET",
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? "SET" : "NOT SET"
    };
    
    // Check Gmail tokens
    const { get } = require("./_redis");
    const gmailEmail = await get("gmail:email");
    const gmailToken = await get("gmail:access_token");
    const gmailRefresh = await get("gmail:refresh_token");
    const gmailExpires = await get("gmail:expires_at");
    
    const gmailStatus = {
      email: gmailEmail || "NOT SET",
      accessToken: gmailToken ? "SET" : "NOT SET",
      refreshToken: gmailRefresh ? "SET" : "NOT SET",
      expiresAt: gmailExpires || "NOT SET",
      isExpired: gmailExpires ? Date.now() > parseInt(gmailExpires) : "UNKNOWN"
    };
    
    res.json({
      success: true,
      environment: envVars,
      gmail: gmailStatus,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};