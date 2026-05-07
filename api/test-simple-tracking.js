// api/test-simple-tracking.js — Simple tracking test without HTTP layer
const { trackOpen, trackClick, set, ensureTable } = require("./_redis");

module.exports = async (req, res) => {
  try {
    await ensureTable();
    
    const testId = `simple_test_${Date.now()}`;
    const testCampaign = `camp_${Date.now()}`;
    
    // Set guard key in the past to bypass timing restrictions
    await set(`email:guard:${testId}`, String(Date.now() - 30000), 60);
    
    // Test with a safe IP and user agent
    const testIp = '192.168.1.100'; // Local IP, not blocked
    const testUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'; // Normal browser UA
    
    // Test open tracking
    const openResult = await trackOpen(testId, testIp, testUA, testCampaign);
    
    // Test click tracking  
    const clickResult = await trackClick(testId, testIp, testUA, 'https://example.com', testCampaign);
    
    res.json({
      success: true,
      testId,
      openResult,
      clickResult,
      message: 'Direct tracking test completed'
    });
    
  } catch (error) {
    console.error('Simple tracking test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};