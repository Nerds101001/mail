// api/events.js — Direct events endpoint
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const { leadId } = req.query;
    
    if (!leadId) {
      return res.json({ events: [], error: "Missing leadId parameter" });
    }
    
    console.log(`📋 [EVENTS] Fetching events for lead: ${leadId}`);
    
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    const events = await sql`
      SELECT event_type, ip, user_agent, target_url, created_at
      FROM tracking_events 
      WHERE lead_id = ${leadId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    
    console.log(`✅ [EVENTS] Found ${events.length} events for lead ${leadId}`);
    
    return res.json({ events });
    
  } catch (error) {
    console.error(`❌ [EVENTS ERROR]:`, error.message);
    return res.json({ events: [], error: error.message });
  }
};