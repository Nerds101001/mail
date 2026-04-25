// api/debug-tracking-flow.js — Debug the complete tracking flow
const { incr, logEvent, getTrackingStats, ensureTable } = require("./_redis");
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    console.log("🔍 [DEBUG FLOW] Starting comprehensive tracking debug...");
    
    // Step 1: Test database connection
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    console.log("✅ [DEBUG FLOW] Database connection established");
    
    // Step 2: Ensure tables exist
    await ensureTable();
    console.log("✅ [DEBUG FLOW] Tables initialized");
    
    // Step 3: Create a test lead and track it
    const testLeadId = `debug_lead_${Date.now()}`;
    console.log(`🧪 [DEBUG FLOW] Creating test lead: ${testLeadId}`);
    
    // Step 4: Simulate tracking
    const openCount = await incr(`track:open:${testLeadId}`);
    console.log(`📊 [DEBUG FLOW] Open count after increment: ${openCount}`);
    
    await logEvent({
      lead_id: testLeadId,
      event_type: "open",
      ip: "127.0.0.1",
      user_agent: "Debug Browser"
    });
    console.log("📝 [DEBUG FLOW] Event logged");
    
    // Step 5: Check database directly
    const directQuery = await sql`SELECT * FROM simple_tracking WHERE lead_id = ${testLeadId}`;
    console.log(`🔍 [DEBUG FLOW] Direct database query result:`, directQuery);
    
    // Step 6: Test getTrackingStats function
    const stats = await getTrackingStats([testLeadId]);
    console.log(`📈 [DEBUG FLOW] getTrackingStats result:`, stats);
    
    // Step 7: Test with multiple leads including the one from your test
    const allTestLeads = [testLeadId, "test_lead_1777116488730"];
    const allStats = await getTrackingStats(allTestLeads);
    console.log(`📊 [DEBUG FLOW] All stats:`, allStats);
    
    // Step 8: Check all tracking data in database
    const allTrackingData = await sql`SELECT * FROM simple_tracking ORDER BY last_open DESC LIMIT 20`;
    console.log(`📋 [DEBUG FLOW] All tracking data in database:`, allTrackingData);
    
    res.json({
      success: true,
      testLeadId,
      openCount,
      directQuery,
      stats,
      allStats,
      allTrackingData,
      message: "Debug flow completed successfully"
    });
    
  } catch (error) {
    console.error("❌ [DEBUG FLOW] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};