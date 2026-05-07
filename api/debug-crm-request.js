// api/debug-crm-request.js — Debug what the CRM is actually requesting
const { getDb, ensureTable } = require("./_redis");

module.exports = async (req, res) => {
  try {
    await ensureTable();
    const sql = getDb();
    
    // Get campaign data to see what lead_ids are being used
    const campaigns = await sql`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 5`;
    const campaignLeads = await sql`SELECT * FROM campaign_leads ORDER BY sent_at DESC LIMIT 10`;
    
    // Log the request details
    console.log('🔍 [DEBUG CRM REQUEST]', {
      query: req.query,
      method: req.method,
      url: req.url
    });
    
    res.json({
      success: true,
      request: {
        query: req.query,
        method: req.method,
        url: req.url
      },
      campaigns: campaigns.slice(0, 3), // Limit for readability
      campaignLeads: campaignLeads.slice(0, 5), // Limit for readability
      message: 'Check server logs for request details'
    });
    
  } catch (error) {
    console.error('Debug CRM request failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};