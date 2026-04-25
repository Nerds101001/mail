// api/tracking-stats.js — Working tracking stats for CRM frontend
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.json({});
    }
    
    const leadIds = ids.split(",").filter(Boolean);
    console.log(`📊 [TRACKING STATS] Request for ${leadIds.length} leads:`, leadIds);
    
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    // Get stats from simple_tracking table
    const rows = await sql`
      SELECT lead_id, opens, clicks 
      FROM simple_tracking 
      WHERE lead_id = ANY(${leadIds})
    `;
    
    const stats = {};
    rows.forEach(row => {
      stats[row.lead_id] = {
        opens: parseInt(row.opens) || 0,
        clicks: parseInt(row.clicks) || 0
      };
    });
    
    // Fill in missing leads with zero counts
    leadIds.forEach(id => {
      if (!stats[id]) {
        stats[id] = { opens: 0, clicks: 0 };
      }
    });
    
    console.log(`✅ [TRACKING STATS] Returning stats:`, stats);
    return res.json(stats);
    
  } catch (error) {
    console.error(`❌ [TRACKING STATS ERROR]:`, error.message);
    return res.status(500).json({ error: "Failed to fetch tracking stats" });
  }
};