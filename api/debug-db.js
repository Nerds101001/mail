// api/debug-db.js — Debug database contents
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    // Check if tables exist
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('simple_tracking', 'tracking_events', 'kv_store')
    `;
    
    // Get all tracking data
    const trackingData = await sql`SELECT * FROM simple_tracking ORDER BY last_open DESC LIMIT 10`;
    const eventData = await sql`SELECT * FROM tracking_events ORDER BY created_at DESC LIMIT 10`;
    
    res.json({
      success: true,
      tables: tables.map(t => t.table_name),
      trackingData,
      eventData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
};