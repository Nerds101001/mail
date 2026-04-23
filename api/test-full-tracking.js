// api/test-full-tracking.js — Full end-to-end tracking test
const { incr, logEvent, getTrackingStats } = require("./_redis");

module.exports = async (req, res) => {
  try {
    console.log("🧪 [FULL TRACKING TEST] Starting comprehensive test...");
    
    // Create test lead IDs that match CRM format
    const testLeads = [
      `lead_${Date.now()}`,
      `lead_${Date.now() + 1}`,
      `lead_${Date.now() + 2}`
    ];
    
    console.log("📝 [FULL TRACKING TEST] Test lead IDs:", testLeads);
    
    // Simulate tracking events for each lead
    const results = [];
    
    for (let i = 0; i < testLeads.length; i++) {
      const leadId = testLeads[i];
      
      // Simulate opens (1-3 opens per lead)
      const openCount = i + 1;
      for (let j = 0; j < openCount; j++) {
        await incr(`track:open:${leadId}`);
        await logEvent({
          lead_id: leadId,
          event_type: "open",
          ip: `192.168.1.${100 + j}`,
          user_agent: `Test Browser ${j + 1}`
        });
      }
      
      // Simulate clicks (0-2 clicks per lead)
      const clickCount = i > 0 ? i : 0;
      for (let j = 0; j < clickCount; j++) {
        await incr(`track:click:${leadId}`);
        await logEvent({
          lead_id: leadId,
          event_type: "click",
          ip: `192.168.1.${100 + j}`,
          user_agent: `Test Browser ${j + 1}`,
          target_url: `https://example.com/page${j + 1}`
        });
      }
      
      results.push({
        leadId,
        expectedOpens: openCount,
        expectedClicks: clickCount
      });
    }
    
    // Test the tracking stats retrieval
    const stats = await getTrackingStats(testLeads);
    console.log("📊 [FULL TRACKING TEST] Retrieved stats:", stats);
    
    // Test the frontend endpoint
    const frontendUrl = `/api/tracking-stats?ids=${testLeads.join(',')}`;
    console.log("🌐 [FULL TRACKING TEST] Frontend URL:", frontendUrl);
    
    // Verify results
    let allCorrect = true;
    const verification = results.map(r => {
      const stat = stats[r.leadId];
      const opensMatch = stat && stat.opens === r.expectedOpens;
      const clicksMatch = stat && stat.clicks === r.expectedClicks;
      const correct = opensMatch && clicksMatch;
      
      if (!correct) allCorrect = false;
      
      return {
        leadId: r.leadId,
        expected: { opens: r.expectedOpens, clicks: r.expectedClicks },
        actual: stat || { opens: 0, clicks: 0 },
        correct
      };
    });
    
    res.json({
      success: allCorrect,
      message: allCorrect ? "All tracking working correctly!" : "Some tracking issues detected",
      testLeads,
      stats,
      verification,
      frontendUrl,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ [FULL TRACKING TEST] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};