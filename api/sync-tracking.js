// api/sync-tracking.js — Sync tracking counters from events
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    console.log("🔄 [SYNC] Starting tracking sync...");
    
    // Create simple_tracking table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS simple_tracking (
        lead_id TEXT PRIMARY KEY,
        opens INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        last_open BIGINT,
        last_click BIGINT
      )
    `;
    
    // Sync opens from tracking_events
    const openSync = await sql`
      INSERT INTO simple_tracking (lead_id, opens, last_open)
      SELECT 
        lead_id,
        COUNT(*) as opens,
        MAX(created_at) as last_open
      FROM tracking_events 
      WHERE event_type = 'open'
      GROUP BY lead_id
      ON CONFLICT (lead_id) DO UPDATE SET
        opens = EXCLUDED.opens,
        last_open = EXCLUDED.last_open
    `;
    
    // Sync clicks from tracking_events  
    const clickSync = await sql`
      INSERT INTO simple_tracking (lead_id, clicks, last_click)
      SELECT 
        lead_id,
        COUNT(*) as clicks,
        MAX(created_at) as last_click
      FROM tracking_events 
      WHERE event_type = 'click'
      GROUP BY lead_id
      ON CONFLICT (lead_id) DO UPDATE SET
        clicks = EXCLUDED.clicks,
        last_click = EXCLUDED.last_click
    `;
    
    // Get final results
    const results = await sql`SELECT * FROM simple_tracking ORDER BY last_open DESC`;
    
    console.log(`✅ [SYNC] Synced ${results.length} leads`);
    
    res.json({
      success: true,
      message: `Synced ${results.length} leads from events to counters`,
      results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ [SYNC] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};