// api/tracking-stats.js — Get tracking statistics for multiple leads
const { getTrackingStats } = require("./_redis");

module.exports = async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.status(400).json({ error: 'Missing ids parameter' });
    }
    
    // Parse comma-separated lead IDs
    const leadIds = ids.split(',').map(id => id.trim()).filter(id => id);
    
    if (leadIds.length === 0) {
      return res.json({});
    }
    
    console.log(`📊 [TRACKING STATS] Fetching stats for ${leadIds.length} leads`);
    
    // Get tracking stats from database
    const stats = await getTrackingStats(leadIds);
    
    console.log(`✅ [TRACKING STATS] Retrieved stats for ${Object.keys(stats).length} leads`);
    
    return res.json(stats);
  } catch (error) {
    console.error(`❌ [TRACKING STATS] Error:`, error.message);
    return res.status(500).json({ error: 'Failed to fetch tracking stats' });
  }
};