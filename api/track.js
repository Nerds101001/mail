// api/track.js — Unified tracking endpoint (consolidates track-open, track-click, track-attachment, track-pixel)
const { get, set } = require("./_redis");
const { neon } = require("@neondatabase/serverless");

// Bot detection patterns
const BOT_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i, /scanner/i, /monitor/i, /checker/i,
  /validator/i, /tester/i, /analyzer/i, /inspector/i, /audit/i, /security/i,
  /preview/i, /prefetch/i, /preload/i, /proxy/i, /cache/i, /cdn/i,
  /google/i, /facebook/i, /twitter/i, /linkedin/i, /pinterest/i,
  /mailgun/i, /sendgrid/i, /mandrill/i, /postmark/i, /sparkpost/i,
  /curl/i, /wget/i, /python/i, /java/i, /php/i, /ruby/i, /perl/i,
  /headless/i, /phantom/i, /selenium/i, /puppeteer/i, /playwright/i
];

function isBot(userAgent) {
  if (!userAgent || userAgent === '—') return true;
  return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
}

async function logToDatabase(leadId, campaignId, eventType, eventData, userAgent, ip) {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) return false;
  
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
    
    // Insert tracking event
    await sql`
      INSERT INTO tracking_events (lead_id, campaign_id, event_type, event_data, user_agent, ip_address, timestamp)
      VALUES (${leadId}, ${campaignId || null}, ${eventType}, ${JSON.stringify(eventData || {})}, ${userAgent || ''}, ${ip || 'unknown'}, ${Date.now()})
    `;
    
    return true;
  } catch (error) {
    console.error(`❌ [TRACKING DB] ${eventType} error:`, error.message);
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  
  const { type } = req.query;
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

  // ── EMAIL OPEN TRACKING ────────────────────────────────────────────────
  if (type === 'open') {
    const { id: leadId, cid: campaignId } = req.query;
    
    if (!leadId) {
      console.log('❌ [OPEN] Missing leadId');
      return res.status(400).send('Missing leadId');
    }

    try {
      // Bot detection
      if (isBot(userAgent)) {
        console.log(`🤖 [OPEN] Bot detected: ${userAgent.slice(0, 50)}... - ignoring`);
        return res.status(200).setHeader('Content-Type', 'image/gif').send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
      }

      // Check scanner guard (prevents false opens from email scanners)
      const guardKey = `email:guard:${leadId}`;
      const guardTime = await get(guardKey).catch(() => null);
      
      if (guardTime) {
        const timeSinceSend = Date.now() - parseInt(guardTime);
        if (timeSinceSend < 5000) { // 5 second grace period
          console.log(`🛡️ [OPEN] Scanner guard active for ${leadId} (${timeSinceSend}ms since send) - ignoring`);
          return res.status(200).setHeader('Content-Type', 'image/gif').send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
        }
      }

      // Deduplication check (1-hour window)
      const dedupeKey = `open_dedupe:${leadId}:${campaignId || 'default'}`;
      const lastOpen = await get(dedupeKey).catch(() => null);
      
      if (lastOpen && (Date.now() - parseInt(lastOpen)) < 3600000) {
        console.log(`🔄 [OPEN] Duplicate within 1 hour for ${leadId} - ignoring`);
        return res.status(200).setHeader('Content-Type', 'image/gif').send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
      }

      // Log to database
      await logToDatabase(leadId, campaignId, 'open', { userAgent, ip }, userAgent, ip);

      // Update deduplication cache
      await set(dedupeKey, String(Date.now()), 3600).catch(() => {});

      // Update lead opens count in Redis
      try {
        const leads = await get("leads").then(data => data ? JSON.parse(data) : []).catch(() => []);
        const leadIndex = leads.findIndex(l => l.id === leadId);
        
        if (leadIndex !== -1) {
          leads[leadIndex].opens = (leads[leadIndex].opens || 0) + 1;
          await set("leads", JSON.stringify(leads));
        }
      } catch (error) {
        console.error('❌ [OPEN] Redis update failed:', error.message);
      }

      console.log(`👁️ [OPEN] Tracked: ${leadId} ${campaignId ? `(campaign: ${campaignId})` : ''}`);

      // Return 1x1 transparent GIF
      res.status(200)
        .setHeader('Content-Type', 'image/gif')
        .setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        .setHeader('Pragma', 'no-cache')
        .setHeader('Expires', '0')
        .send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));

    } catch (error) {
      console.error('❌ [OPEN] Error:', error.message);
      res.status(200).setHeader('Content-Type', 'image/gif').send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    }
  }

  // ── LINK CLICK TRACKING ────────────────────────────────────────────────
  else if (type === 'click') {
    const { id: leadId, cid: campaignId, url } = req.query;
    
    if (!leadId || !url) {
      return res.status(400).json({ error: 'Missing leadId or url' });
    }

    try {
      // Bot detection
      if (isBot(userAgent)) {
        console.log(`🤖 [CLICK] Bot detected: ${userAgent.slice(0, 50)}... - redirecting without tracking`);
        return res.redirect(302, decodeURIComponent(url));
      }

      // Deduplication check (5-minute window)
      const dedupeKey = `click_dedupe:${leadId}:${campaignId || 'default'}:${Buffer.from(url).toString('base64').slice(0, 20)}`;
      const lastClick = await get(dedupeKey).catch(() => null);
      
      if (lastClick && (Date.now() - parseInt(lastClick)) < 300000) {
        console.log(`🔄 [CLICK] Duplicate within 5 minutes for ${leadId} - redirecting without tracking`);
        return res.redirect(302, decodeURIComponent(url));
      }

      // Log to database
      await logToDatabase(leadId, campaignId, 'click', { url: decodeURIComponent(url), userAgent, ip }, userAgent, ip);

      // Update deduplication cache
      await set(dedupeKey, String(Date.now()), 300).catch(() => {});

      // Update lead clicks count in Redis
      try {
        const leads = await get("leads").then(data => data ? JSON.parse(data) : []).catch(() => []);
        const leadIndex = leads.findIndex(l => l.id === leadId);
        
        if (leadIndex !== -1) {
          leads[leadIndex].clicks = (leads[leadIndex].clicks || 0) + 1;
          await set("leads", JSON.stringify(leads));
        }
      } catch (error) {
        console.error('❌ [CLICK] Redis update failed:', error.message);
      }

      console.log(`🖱️ [CLICK] Tracked: ${leadId} -> ${decodeURIComponent(url)} ${campaignId ? `(campaign: ${campaignId})` : ''}`);

      // Redirect to the actual URL
      res.redirect(302, decodeURIComponent(url));

    } catch (error) {
      console.error('❌ [CLICK] Error:', error.message);
      res.redirect(302, decodeURIComponent(url));
    }
  }

  // ── ATTACHMENT DOWNLOAD TRACKING ───────────────────────────────────────
  else if (type === 'attachment') {
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

      // Log to database
      await logToDatabase(leadId, campaignId, 'attachment_click', {
        attachment_id: attachmentId,
        attachment_label: attachment.label,
        attachment_name: attachment.originalName,
        attachment_size: attachment.size
      }, userAgent, ip);

      // Update lead attachment clicks count
      try {
        const leads = await get("leads").then(data => data ? JSON.parse(data) : []).catch(() => []);
        const leadIndex = leads.findIndex(l => l.id === leadId);
        
        if (leadIndex !== -1) {
          if (!leads[leadIndex].attachment_clicks) {
            leads[leadIndex].attachment_clicks = 0;
          }
          leads[leadIndex].attachment_clicks++;
          
          if (!leads[leadIndex].clicks) {
            leads[leadIndex].clicks = 0;
          }
          leads[leadIndex].clicks++;
          
          await set("leads", JSON.stringify(leads));
        }
      } catch (error) {
        console.error('❌ [ATTACHMENT] Redis update failed:', error.message);
      }

      // Update attachment download count
      attachment.downloadCount = (attachment.downloadCount || 0) + 1;
      await set("attachments", JSON.stringify(attachments));

      console.log(`📎 [ATTACHMENT] Lead ${leadId} downloaded ${attachment.label} (${attachment.originalName})`);

      // Return the actual file
      const buffer = Buffer.from(attachment.base64Data, 'base64');
      
      res.setHeader('Content-Type', attachment.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);

    } catch (error) {
      console.error("❌ [ATTACHMENT] Error:", error.message);
      res.status(500).json({ error: "Tracking failed" });
    }
  }

  // ── PIXEL TRACKING (Legacy) ────────────────────────────────────────────
  else if (type === 'pixel') {
    // Legacy pixel tracking - redirect to open tracking
    const { id, cid } = req.query;
    return res.redirect(301, `/api/track?type=open&id=${id}&cid=${cid || ''}`);
  }

  else {
    res.status(400).json({ error: "Invalid tracking type. Use: open, click, attachment, or pixel" });
  }
};