// api/seed-demo.js — Simple integer-only demo seeder
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    console.log("🌱 Starting demo data creation...");
    
    // Ensure tables exist first
    await sql`CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY, 
      user_id TEXT, 
      name TEXT, 
      created_at BIGINT, 
      target TEXT, 
      sender TEXT, 
      total_sent INT DEFAULT 0, 
      total_failed INT DEFAULT 0, 
      total_skipped INT DEFAULT 0, 
      stats JSONB DEFAULT '{}'
    )`;
    
    await sql`CREATE TABLE IF NOT EXISTS campaign_leads (
      id SERIAL PRIMARY KEY, 
      campaign_id TEXT, 
      user_id TEXT, 
      lead_id TEXT, 
      lead_name TEXT, 
      lead_email TEXT, 
      lead_company TEXT, 
      status TEXT DEFAULT 'sent', 
      subject TEXT, 
      sent_at BIGINT, 
      opens INT DEFAULT 0, 
      clicks INT DEFAULT 0,
      UNIQUE(campaign_id, lead_id)
    )`;
    
    // Fixed integer timestamps
    const time1 = 1777000000000;
    const time2 = 1776900000000;
    const time3 = 1776800000000;
    
    // Insert campaigns with fixed values
    await sql`
      INSERT INTO campaigns (id, user_id, name, created_at, target, sender, total_sent, total_failed, total_skipped, stats)
      VALUES ('demo_camp_1', 'admin', 'Q1 2026 Product Launch', ${time1}, 'enterprise', 'sales@enginerds.in', 45, 2, 1, '{"opens": 28, "clicks": 12, "replies": 3}')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        total_sent = EXCLUDED.total_sent,
        stats = EXCLUDED.stats
    `;
    
    await sql`
      INSERT INTO campaigns (id, user_id, name, created_at, target, sender, total_sent, total_failed, total_skipped, stats)
      VALUES ('demo_camp_2', 'admin', 'Holiday Special Offer', ${time2}, 'all', 'marketing@enginerds.in', 60, 1, 0, '{"opens": 42, "clicks": 18, "replies": 5}')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        total_sent = EXCLUDED.total_sent,
        stats = EXCLUDED.stats
    `;
    
    await sql`
      INSERT INTO campaigns (id, user_id, name, created_at, target, sender, total_sent, total_failed, total_skipped, stats)
      VALUES ('demo_camp_3', 'admin', 'Webinar Invitation Series', ${time3}, 'prospects', 'events@enginerds.in', 35, 0, 2, '{"opens": 25, "clicks": 8, "replies": 2}')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        total_sent = EXCLUDED.total_sent,
        stats = EXCLUDED.stats
    `;
    
    // Insert leads with fixed values
    const leadData = [
      ['demo_camp_1', 'lead_demo_1', 'Sarah Johnson', 'sarah@techcorp.com', 'TechCorp Inc', 'clicked', 'Q1 Product Launch', time1, 3, 2],
      ['demo_camp_1', 'lead_demo_2', 'Michael Chen', 'mchen@innovate.io', 'Innovate Solutions', 'opened', 'Q1 Product Launch', time1, 2, 0],
      ['demo_camp_1', 'lead_demo_3', 'Emily Rodriguez', 'emily@startupx.com', 'StartupX', 'replied', 'Q1 Product Launch', time1, 5, 3],
      ['demo_camp_2', 'lead_demo_4', 'David Kim', 'david@enterprise.com', 'Enterprise Corp', 'clicked', 'Holiday Special Offer', time2, 4, 2],
      ['demo_camp_2', 'lead_demo_5', 'Lisa Wang', 'lisa@futuretech.ai', 'FutureTech AI', 'opened', 'Holiday Special Offer', time2, 1, 0],
      ['demo_camp_2', 'lead_demo_6', 'Robert Taylor', 'rtaylor@bigcorp.com', 'BigCorp Ltd', 'clicked', 'Holiday Special Offer', time2, 6, 4],
      ['demo_camp_3', 'lead_demo_7', 'Jennifer Lee', 'jlee@startup.co', 'Startup Co', 'opened', 'Webinar Invitation', time3, 2, 0],
      ['demo_camp_3', 'lead_demo_8', 'Alex Thompson', 'alex@techventure.com', 'TechVenture', 'clicked', 'Webinar Invitation', time3, 3, 1],
      ['demo_camp_3', 'lead_demo_9', 'Maria Garcia', 'maria@digitalfirm.com', 'Digital Firm', 'replied', 'Webinar Invitation', time3, 7, 2]
    ];
    
    for (const lead of leadData) {
      await sql`
        INSERT INTO campaign_leads (campaign_id, user_id, lead_id, lead_name, lead_email, lead_company, status, subject, sent_at, opens, clicks)
        VALUES (${lead[0]}, 'admin', ${lead[1]}, ${lead[2]}, ${lead[3]}, ${lead[4]}, ${lead[5]}, ${lead[6]}, ${lead[7]}, ${lead[8]}, ${lead[9]})
        ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
          status = EXCLUDED.status,
          opens = EXCLUDED.opens,
          clicks = EXCLUDED.clicks
      `;
    }
    
    // Create tracking events with simple fixed times
    const trackingData = [
      ['lead_demo_1', 'open', 1777003600000], ['lead_demo_1', 'open', 1777007200000], ['lead_demo_1', 'open', 1777010800000],
      ['lead_demo_1', 'click', 1777014400000], ['lead_demo_1', 'click', 1777018000000],
      ['lead_demo_2', 'open', 1777003600000], ['lead_demo_2', 'open', 1777007200000],
      ['lead_demo_3', 'open', 1777003600000], ['lead_demo_3', 'open', 1777007200000], ['lead_demo_3', 'open', 1777010800000], ['lead_demo_3', 'open', 1777014400000], ['lead_demo_3', 'open', 1777018000000],
      ['lead_demo_3', 'click', 1777021600000], ['lead_demo_3', 'click', 1777025200000], ['lead_demo_3', 'click', 1777028800000],
      ['lead_demo_4', 'open', 1776903600000], ['lead_demo_4', 'open', 1776907200000], ['lead_demo_4', 'open', 1776910800000], ['lead_demo_4', 'open', 1776914400000],
      ['lead_demo_4', 'click', 1776918000000], ['lead_demo_4', 'click', 1776921600000],
      ['lead_demo_5', 'open', 1776903600000],
      ['lead_demo_6', 'open', 1776903600000], ['lead_demo_6', 'open', 1776907200000], ['lead_demo_6', 'open', 1776910800000], ['lead_demo_6', 'open', 1776914400000], ['lead_demo_6', 'open', 1776918000000], ['lead_demo_6', 'open', 1776921600000],
      ['lead_demo_6', 'click', 1776925200000], ['lead_demo_6', 'click', 1776928800000], ['lead_demo_6', 'click', 1776932400000], ['lead_demo_6', 'click', 1776936000000],
      ['lead_demo_7', 'open', 1776803600000], ['lead_demo_7', 'open', 1776807200000],
      ['lead_demo_8', 'open', 1776803600000], ['lead_demo_8', 'open', 1776807200000], ['lead_demo_8', 'open', 1776810800000],
      ['lead_demo_8', 'click', 1776814400000],
      ['lead_demo_9', 'open', 1776803600000], ['lead_demo_9', 'open', 1776807200000], ['lead_demo_9', 'open', 1776810800000], ['lead_demo_9', 'open', 1776814400000], ['lead_demo_9', 'open', 1776818000000], ['lead_demo_9', 'open', 1776821600000], ['lead_demo_9', 'open', 1776825200000],
      ['lead_demo_9', 'click', 1776828800000], ['lead_demo_9', 'click', 1776832400000]
    ];
    
    for (const track of trackingData) {
      await sql`
        INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, created_at)
        VALUES (${track[0]}, ${track[1]}, '192.168.1.100', 'Mozilla/5.0', ${track[2]})
      `;
    }
    
    // Create tracking counters with fixed values
    const counterData = [
      ['lead_demo_1', 3, 2, 1777010800000, 1777018000000],
      ['lead_demo_2', 2, 0, 1777007200000, null],
      ['lead_demo_3', 5, 3, 1777018000000, 1777028800000],
      ['lead_demo_4', 4, 2, 1776914400000, 1776921600000],
      ['lead_demo_5', 1, 0, 1776903600000, null],
      ['lead_demo_6', 6, 4, 1776921600000, 1776936000000],
      ['lead_demo_7', 2, 0, 1776807200000, null],
      ['lead_demo_8', 3, 1, 1776810800000, 1776814400000],
      ['lead_demo_9', 7, 2, 1776825200000, 1776832400000]
    ];
    
    for (const counter of counterData) {
      await sql`
        INSERT INTO tracking_counters (lead_id, opens, clicks, last_open, last_click)
        VALUES (${counter[0]}, ${counter[1]}, ${counter[2]}, ${counter[3]}, ${counter[4]})
        ON CONFLICT (lead_id) DO UPDATE SET
          opens = EXCLUDED.opens,
          clicks = EXCLUDED.clicks,
          last_open = EXCLUDED.last_open,
          last_click = EXCLUDED.last_click
      `;
    }
    
    console.log("✅ Demo data created successfully!");
    
    const result = {
      success: true,
      message: "🎉 Demo data created successfully!",
      data: {
        campaigns: 3,
        leads: 9,
        tracking_events: trackingData.length
      },
      next_steps: [
        "Visit Campaign History to see tracking data",
        "Check Tracking page for analytics", 
        "Browse Leads with engagement stats"
      ],
      timestamp: new Date().toISOString()
    };
    
    // Return HTML for GET requests, JSON for POST requests
    if (req.method === 'GET') {
      const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Demo Data Seeder - Success!</title>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
          .success { background: #10b981; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .stats { background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; }
          .stat { display: inline-block; margin: 10px 20px 10px 0; }
          .number { font-size: 24px; font-weight: bold; color: #1e293b; }
          .label { font-size: 14px; color: #64748b; text-transform: uppercase; }
          .next-steps { background: #eff6ff; padding: 20px; border-radius: 8px; border: 1px solid #bfdbfe; margin-top: 20px; }
          a { color: #2563eb; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>🎉 Demo Data Created Successfully!</h1>
          <p>Your CRM has been populated with comprehensive demo data including campaigns, leads, and tracking information.</p>
        </div>
        
        <div class="stats">
          <h2>📊 Data Summary</h2>
          <div class="stat">
            <div class="number">${result.data.campaigns}</div>
            <div class="label">Campaigns</div>
          </div>
          <div class="stat">
            <div class="number">${result.data.leads}</div>
            <div class="label">Leads</div>
          </div>
          <div class="stat">
            <div class="number">${result.data.tracking_events}</div>
            <div class="label">Tracking Events</div>
          </div>
        </div>
        
        <div class="next-steps">
          <h3>🚀 Next Steps</h3>
          <p>Your demo data is ready! You can now:</p>
          <ul>
            <li><a href="https://enginerdsmail.vercel.app">Visit your CRM dashboard</a></li>
            <li><a href="https://enginerdsmail.vercel.app/#/campaign-history">View Campaign History</a> to see tracking data</li>
            <li><a href="https://enginerdsmail.vercel.app/#/tracking">Check the Tracking page</a> for detailed analytics</li>
            <li><a href="https://enginerdsmail.vercel.app/#/leads">Browse all Leads</a> with engagement data</li>
          </ul>
          <p><strong>Note:</strong> Campaign History now shows "opened 3x", "clicked 2x" instead of just "sent" status!</p>
        </div>
        
        <p style="text-align: center; margin-top: 40px; color: #64748b; font-size: 14px;">
          Generated at ${result.timestamp}
        </p>
      </body>
      </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } else {
      res.json(result);
    }
    
  } catch (error) {
    console.error("❌ Demo seed error:", error);
    
    const errorResult = {
      success: false,
      error: error.message,
      stack: error.stack
    };
    
    if (req.method === 'GET') {
      const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Demo Data Seeder - Error</title>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
          .error { background: #ef4444; color: white; padding: 20px; border-radius: 8px; }
          .details { background: #fef2f2; padding: 20px; border-radius: 8px; border: 1px solid #fecaca; margin-top: 20px; }
          pre { background: #1f2937; color: #f9fafb; padding: 15px; border-radius: 6px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>❌ Demo Data Creation Failed</h1>
          <p>There was an error creating the demo data.</p>
        </div>
        
        <div class="details">
          <h3>Error Details:</h3>
          <p><strong>Message:</strong> ${error.message}</p>
          <pre>${error.stack}</pre>
        </div>
      </body>
      </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.status(500).send(errorHtml);
    } else {
      res.status(500).json(errorResult);
    }
  }
};