// api/tracking-stats.js — Tracking stats endpoint for CRM frontend
const { getTrackingStats } = require("./_redis");

module.exports = async (req, res) => {
  try {
    console.log("📊 [TRACKING STATS] Request received:", req.query);
    
    const { ids } = req.query;
    
    if (!ids) {
      console.log("📊 [TRACKING STATS] No IDs provided");
      return res.json({});
    }
    
    const leadIds = ids.split(",").filter(Boolean);
    console.log(`📊 [TRACKING STATS] Processing ${leadIds.length} lead IDs:`, leadIds);
    
    const stats = await getTrackingStats(leadIds);
    console.log(`📊 [TRACKING STATS] Retrieved stats:`, stats);
    
    console.log(`✅ [TRACKING STATS] Returning stats for ${Object.keys(stats).length} leads`);
    return res.json(stats);
    
  } catch (error) {
    console.error(`❌ [TRACKING STATS ERROR]:`, error.message, error.stack);
    return res.status(500).json({ error: "Failed to fetch tracking stats", details: error.message });
  }
};