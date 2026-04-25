// api/test-incr.js — Test the incr function directly
const { incr, logEvent } = require("./_redis");

module.exports = async (req, res) => {
  try {
    const testLeadId = "lead_1776339277390"; // Use the real lead ID from your email
    
    console.log(`🧪 [TEST INCR] Starting test for lead: ${testLeadId}`);
    
    // Test the incr function directly
    const openCount = await incr(`track:open:${testLeadId}`);
    console.log(`🧪 [TEST INCR] Incr returned: ${openCount}`);
    
    // Test logEvent function
    await logEvent({
      lead_id: testLeadId,
      event_type: "open",
      ip: "127.0.0.1",
      user_agent: "Test Browser"
    });
    console.log(`🧪 [TEST INCR] LogEvent completed`);
    
    res.json({
      success: true,
      testLeadId,
      openCount,
      message: "Incr test completed - check database"
    });
    
  } catch (error) {
    console.error("❌ [TEST INCR] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};