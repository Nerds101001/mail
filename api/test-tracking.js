// api/test-tracking.js — Simple tracking test endpoint (updated)
const { incr, logEvent, getTrackingStats, ensureTable } = require("./_redis");

module.exports = async (req, res) => {
  try {
    console.log("🧪 [TRACKING TEST] Starting test...");
    
    // Test database initialization
    await ensureTable();
    console.log("✅ [TRACKING TEST] Database initialized");
    
    // Test tracking increment
    const testLeadId = "test_lead_" + Date.now();
    const openCount = await incr(`track:open:${testLeadId}`);
    console.log(`✅ [TRACKING TEST] Open increment: ${openCount}`);
    
    // Test event logging
    await logEvent({
      lead_id: testLeadId,
      event_type: "open",
      ip: "127.0.0.1",
      user_agent: "Test Agent"
    });
    console.log("✅ [TRACKING TEST] Event logged");
    
    // Test stats retrieval
    const stats = await getTrackingStats([testLeadId]);
    console.log(`✅ [TRACKING TEST] Stats retrieved:`, stats);
    
    res.json({
      success: true,
      testLeadId,
      openCount,
      stats,
      message: "Tracking system working correctly"
    });
    
  } catch (error) {
    console.error("❌ [TRACKING TEST] Error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};