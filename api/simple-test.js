// api/simple-test.js — Simple database test
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    // Test basic connection
    const testQuery = await sql`SELECT 1 as test`;
    console.log("Database connection test:", testQuery);
    
    // Check what tables exist
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    console.log("Available tables:", tables);
    
    // Check simple_tracking table
    const trackingData = await sql`SELECT * FROM simple_tracking LIMIT 5`;
    console.log("Simple tracking data:", trackingData);
    
    // Test specific lead
    const specificLead = await sql`
      SELECT * FROM simple_tracking 
      WHERE lead_id = 'lead_1776339277390'
    `;
    console.log("Specific lead data:", specificLead);
    
    res.json({
      success: true,
      connection: testQuery,
      tables: tables.map(t => t.table_name),
      trackingData,
      specificLead,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("Simple test error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};