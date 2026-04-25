// api/tracking-stats.js — FIXED tracking stats for CRM frontend
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.json({});
    }
    
    const leadIds = ids.split(",").filter(Boolean);
    console.log(`📊 [TRACKING STATS] Request for leads:`, leadIds);
    
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    // FIXED: Use proper SQL syntax for array queries
    const stats = {};
    
    // Query each lead individually to avoid array issues
    for (const leadId of leadIds) {
      try {
        const rows = await sql`
          SELECT lead_id, opens, clicks 
          FROM simple_tracking 
          WHERE lead_id = ${leadId}
        `;
        
        if (rows.length > 0) {
          const row = rows[0];
          stats[row.lead_id] = {
            opens: parseInt(row.opens) || 0,
            clicks: parseInt(row.clicks) || 0
          };
        } else {
          stats[leadId] = { opens: 0, clicks: 0 };
        }
      } catch (e) {
        console.error(`Error querying lead ${leadId}:`, e.message);
        stats[leadId] = { opens: 0, clicks: 0 };
      }
    }
    
    console.log(`✅ [TRACKING STATS] Returning:`, stats);
    return res.json(stats);
    
  } catch (error) {
    console.error(`❌ [TRACKING STATS ERROR]:`, error.message);
    return res.status(500).json({ error: "Failed to fetch tracking stats" });
  }
};