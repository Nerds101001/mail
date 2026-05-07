// api/debug-tracking.js — Debug tracking data
const { getTrackingStats, getDb, ensureTable } = require("./_redis");

module.exports = async (req, res) => {
  try {
    await ensureTable();
    const sql = getDb();
    
    // Get all tracking data
    const trackingData = await sql`SELECT * FROM simple_tracking ORDER BY last_open DESC, last_click DESC LIMIT 20`;
    const trackingEvents = await sql`SELECT * FROM tracking_events ORDER BY created_at DESC LIMIT 20`;
    
    // Get some sample stats
    const leadIds = trackingData.map(row => row.lead_id);
    const stats = leadIds.length > 0 ? await getTrackingStats(leadIds) : {};
    
    res.json({
      success: true,
      trackingData,
      trackingEvents,
      stats,
      leadCount: trackingData.length,
      eventCount: trackingEvents.length
    });
    
  } catch (error) {
    console.error('Debug tracking failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};