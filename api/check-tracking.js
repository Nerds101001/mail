// api/check-tracking.js — Check what tracking data exists
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    // Check what tables exist
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%track%'
    `;
    
    // Check simple_tracking table
    let trackingData = [];
    try {
      trackingData = await sql`SELECT * FROM simple_tracking ORDER BY last_open DESC LIMIT 20`;
    } catch (e) {
      trackingData = [`Error: ${e.message}`];
    }
    
    // Check tracking_events table
    let eventData = [];
    try {
      eventData = await sql`SELECT * FROM tracking_events ORDER BY created_at DESC LIMIT 20`;
    } catch (e) {
      eventData = [`Error: ${e.message}`];
    }
    
    // Check for specific lead
    const { leadId } = req.query;
    let specificLead = null;
    if (leadId) {
      try {
        const specific = await sql`SELECT * FROM simple_tracking WHERE lead_id = ${leadId}`;
        specificLead = specific[0] || "Not found";
      } catch (e) {
        specificLead = `Error: ${e.message}`;
      }
    }
    
    res.json({
      success: true,
      tables: tables.map(t => t.table_name),
      trackingData,
      eventData,
      specificLead,
      searchedLeadId: leadId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};