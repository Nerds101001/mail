// Simple database test endpoint
module.exports = async (req, res) => {
  try {
    console.log(`🧪 [DB TEST] Starting database test`);
    
    // Test database connection
    const { ensureTable, incr, logEvent, getTrackingStats } = require("./_redis");
    
    // Test 1: Ensure tables exist
    await ensureTable();
    console.log(`✅ [DB TEST] Tables created successfully`);
    
    // Test 2: Test increment operation
    const testId = `test_${Date.now()}`;
    const count = await incr(`track:open:${testId}`);
    console.log(`✅ [DB TEST] Increment test: ${count}`);
    
    // Test 3: Test event logging
    await logEvent({
      lead_id: testId,
      event_type: "open",
      ip: "127.0.0.1",
      user_agent: "test-agent"
    });
    console.log(`✅ [DB TEST] Event logged successfully`);
    
    // Test 4: Test stats retrieval
    const stats = await getTrackingStats([testId]);
    console.log(`✅ [DB TEST] Stats retrieved:`, stats);
    
    res.json({
      success: true,
      message: "Database test completed successfully",
      testId: testId,
      incrementResult: count,
      statsResult: stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`❌ [DB TEST] Error:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
};