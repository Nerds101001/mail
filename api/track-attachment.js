// api/track-attachment.js — Attachment download tracking
const { get, set } = require("./_redis");
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  
  const { id: leadId, cid: campaignId, attachment: attachmentId } = req.query;
  
  if (!leadId || !attachmentId) {
    return res.status(400).json({ error: "Missing leadId or attachmentId" });
  }

  try {
    // Get attachment data
    const attachments = await get("attachments").then(data => data ? JSON.parse(data) : []).catch(() => []);
    const attachment = attachments.find(att => att.id === attachmentId);
    
    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    // Track the attachment download in tracking_events table
    if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
      try {
        const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
        
        // Ensure tracking_events table exists
        await sql`
          CREATE TABLE IF NOT EXISTS tracking_events (
            id SERIAL PRIMARY KEY,
            lead_id TEXT NOT NULL,
            campaign_id TEXT,
            event_type TEXT NOT NULL,
            event_data JSONB DEFAULT '{}',
            user_agent TEXT,
            ip_address TEXT,
            timestamp BIGINT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `.catch(() => {});
        
        // Insert attachment click event
        await sql`
          INSERT INTO tracking_events (lead_id, campaign_id, event_type, event_data, user_agent, ip_address, timestamp)
          VALUES (${leadId}, ${campaignId || null}, 'attachment_click', ${JSON.stringify({
            attachment_id: attachmentId,
            attachment_label: attachment.label,
            attachment_name: attachment.originalName,
            attachment_size: attachment.size
          })}, ${req.headers['user-agent'] || ''}, ${req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown'}, ${Date.now()})
        `;
        
        console.log(`📎 [ATTACHMENT CLICK] Logged to tracking_events: Lead ${leadId}, Campaign ${campaignId}, Attachment ${attachment.label}`);
      } catch (dbError) {
        console.error("❌ [ATTACHMENT TRACKING] Database error:", dbError.message);
        // Continue with Redis fallback
      }
    }

    // Track the attachment download in Redis (fallback)
    const timestamp = Date.now();
    const trackingKey = `attachment_click:${leadId}:${attachmentId}`;
    
    // Get existing clicks for this attachment
    const existingClicks = await get(trackingKey).then(data => data ? JSON.parse(data) : []).catch(() => []);
    
    // Add new click with timestamp and campaign info
    const newClick = {
      timestamp,
      campaignId: campaignId || null,
      userAgent: req.headers['user-agent'] || '',
      ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown'
    };
    
    existingClicks.push(newClick);
    await set(trackingKey, JSON.stringify(existingClicks));

    // Update lead's attachment click count
    const leads = await get("leads").then(data => data ? JSON.parse(data) : []).catch(() => []);
    const leadIndex = leads.findIndex(l => l.id === leadId);
    
    if (leadIndex !== -1) {
      // Initialize attachment_clicks if it doesn't exist
      if (!leads[leadIndex].attachment_clicks) {
        leads[leadIndex].attachment_clicks = 0;
      }
      leads[leadIndex].attachment_clicks++;
      
      // Also update general clicks count for overall tracking
      if (!leads[leadIndex].clicks) {
        leads[leadIndex].clicks = 0;
      }
      leads[leadIndex].clicks++;
      
      await set("leads", JSON.stringify(leads));
    }

    // Update campaign statistics if campaignId provided
    if (campaignId) {
      const campaigns = await get("campaigns").then(data => data ? JSON.parse(data) : []).catch(() => []);
      const campaignIndex = campaigns.findIndex(c => c.id === campaignId);
      
      if (campaignIndex !== -1) {
        if (!campaigns[campaignIndex].attachment_clicks) {
          campaigns[campaignIndex].attachment_clicks = 0;
        }
        campaigns[campaignIndex].attachment_clicks++;
        await set("campaigns", JSON.stringify(campaigns));
      }
    }

    // Update attachment download count
    attachment.downloadCount = (attachment.downloadCount || 0) + 1;
    await set("attachments", JSON.stringify(attachments));

    console.log(`📎 [ATTACHMENT CLICK] Lead ${leadId} downloaded ${attachment.label} (${attachment.originalName})`);

    // Return the actual file
    const buffer = Buffer.from(attachment.base64Data, 'base64');
    
    res.setHeader('Content-Type', attachment.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);

  } catch (error) {
    console.error("❌ [ATTACHMENT TRACKING] Error:", error.message);
    res.status(500).json({ error: "Tracking failed" });
  }
};