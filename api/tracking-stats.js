// api/tracking-stats.js — Tracking stats endpoint for CRM frontend
const { getTrackingStats } = require("./_redis");

module.exports = async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.json({});
    }
    
    const leadIds = ids.split(",").filter(Boolean);
    console.log(`📊 [TRACKING STATS] Frontend request for ${leadIds.length} leads`);
    
    const stats = await getTrackingStats(leadIds);
    
    console.log(`✅ [TRACKING STATS] Returning stats for ${Object.keys(stats).length} leads`);
    return res.json(stats);
    
  } catch (error) {
    console.error(`❌ [TRACKING STATS ERROR]:`, error.message);
    return res.status(500).json({ error: "Failed to fetch tracking stats" });
  }
};