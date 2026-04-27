// api/seed-demo.js — Add comprehensive demo data to CRM
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    console.log("🌱 [DEMO SEED] Starting demo data creation...");
    
    // Create demo campaigns
    const demoCampaigns = [
      {
        id: 'camp_demo_q1_2026',
        name: 'Q1 2026 Product Launch',
        created_at: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
        target: 'enterprise',
        sender: 'sales@enginerds.in',
        total_sent: 25,
        total_failed: 2,
        total_skipped: 3,
        stats: JSON.stringify({ opens: 45, clicks: 18 })
      },
      {
        id: 'camp_demo_holiday_2025',
        name: 'Holiday Special Offer 2025',
        created_at: Date.now() - (60 * 24 * 60 * 60 * 1000), // 60 days ago
        target: 'all',
        sender: 'marketing@enginerds.in',
        total_sent: 50,
        total_failed: 5,
        total_skipped: 0,
        stats: JSON.stringify({ opens: 89, clicks: 32 })
      },
      {
        id: 'camp_demo_webinar_jan',
        name: 'January Webinar Invitation',
        created_at: Date.now() - (15 * 24 * 60 * 60 * 1000), // 15 days ago
        target: 'prospects',
        sender: 'events@enginerds.in',
        total_sent: 35,
        total_failed: 1,
        total_skipped: 2,
        stats: JSON.stringify({ opens: 67, clicks: 28 })
      }
    ];
    
    // Insert demo campaigns
    for (const campaign of demoCampaigns) {
      await sql`
        INSERT INTO campaigns (id, user_id, name, created_at, target, sender, total_sent, total_failed, total_skipped, stats)
        VALUES (${campaign.id}, 'admin', ${campaign.name}, ${campaign.created_at}, ${campaign.target}, ${campaign.sender}, ${campaign.total_sent}, ${campaign.total_failed}, ${campaign.total_skipped}, ${campaign.stats})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          total_sent = EXCLUDED.total_sent,
          stats = EXCLUDED.stats
      `;
    }
    
    // Create demo campaign leads
    const demoLeads = [
      // Q1 2026 Campaign
      { campaign_id: 'camp_demo_q1_2026', lead_id: 'lead_1776000001', lead_name: 'Sarah Johnson', lead_email: 'sarah.johnson@techcorp.com', lead_company: 'TechCorp Inc', status: 'clicked', subject: 'Introducing Our Revolutionary AI Platform' },
      { campaign_id: 'camp_demo_q1_2026', lead_id: 'lead_1776000002', lead_name: 'Michael Chen', lead_email: 'mchen@innovate.io', lead_company: 'Innovate Solutions', status: 'opened', subject: 'Introducing Our Revolutionary AI Platform' },
      { campaign_id: 'camp_demo_q1_2026', lead_id: 'lead_1776000003', lead_name: 'Emily Rodriguez', lead_email: 'emily@startupx.com', lead_company: 'StartupX', status: 'sent', subject: 'Introducing Our Revolutionary AI Platform' },
      { campaign_id: 'camp_demo_q1_2026', lead_id: 'lead_1776000004', lead_name: 'David Kim', lead_email: 'david.kim@enterprise.com', lead_company: 'Enterprise Corp', status: 'clicked', subject: 'Introducing Our Revolutionary AI Platform' },
      { campaign_id: 'camp_demo_q1_2026', lead_id: 'lead_1776000005', lead_name: 'Lisa Wang', lead_email: 'lisa@futuretech.ai', lead_company: 'FutureTech AI', status: 'opened', subject: 'Introducing Our Revolutionary AI Platform' },
      
      // Holiday Campaign
      { campaign_id: 'camp_demo_holiday_2025', lead_id: 'lead_1776000006', lead_name: 'Robert Taylor', lead_email: 'rtaylor@bigcorp.com', lead_company: 'BigCorp Ltd', status: 'clicked', subject: '🎄 Special Holiday Discount - 40% Off!' },
      { campaign_id: 'camp_demo_holiday_2025', lead_id: 'lead_1776000007', lead_name: 'Jennifer Lee', lead_email: 'jlee@startup.co', lead_company: 'Startup Co', status: 'opened', subject: '🎄 Special Holiday Discount - 40% Off!' },
      { campaign_id: 'camp_demo_holiday_2025', lead_id: 'lead_1776000008', lead_name: 'Alex Thompson', lead_email: 'alex@techventure.com', lead_company: 'TechVenture', status: 'clicked', subject: '🎄 Special Holiday Discount - 40% Off!' },
      { campaign_id: 'camp_demo_holiday_2025', lead_id: 'lead_1776000009', lead_name: 'Maria Garcia', lead_email: 'maria@digitalfirm.com', lead_company: 'Digital Firm', status: 'opened', subject: '🎄 Special Holiday Discount - 40% Off!' },
      { campaign_id: 'camp_demo_holiday_2025', lead_id: 'lead_1776000010', lead_name: 'James Wilson', lead_email: 'jwilson@megacorp.com', lead_company: 'MegaCorp', status: 'clicked', subject: '🎄 Special Holiday Discount - 40% Off!' },
      
      // Webinar Campaign
      { campaign_id: 'camp_demo_webinar_jan', lead_id: 'lead_1776000011', lead_name: 'Amanda Foster', lead_email: 'amanda@growthco.com', lead_company: 'Growth Co', status: 'clicked', subject: '🚀 Join Our Exclusive AI Webinar - Jan 30th' },
      { campaign_id: 'camp_demo_webinar_jan', lead_id: 'lead_1776000012', lead_name: 'Kevin Brown', lead_email: 'kevin@scaleup.io', lead_company: 'ScaleUp Inc', status: 'opened', subject: '🚀 Join Our Exclusive AI Webinar - Jan 30th' },
      { campaign_id: 'camp_demo_webinar_jan', lead_id: 'lead_1776000013', lead_name: 'Rachel Green', lead_email: 'rachel@nextgen.com', lead_company: 'NextGen Tech', status: 'sent', subject: '🚀 Join Our Exclusive AI Webinar - Jan 30th' },
      { campaign_id: 'camp_demo_webinar_jan', lead_id: 'lead_1776000014', lead_name: 'Daniel Martinez', lead_email: 'daniel@cloudtech.com', lead_company: 'CloudTech Solutions', status: 'clicked', subject: '🚀 Join Our Exclusive AI Webinar - Jan 30th' },
      { campaign_id: 'camp_demo_webinar_jan', lead_id: 'lead_1776000015', lead_name: 'Sophie Anderson', lead_email: 'sophie@aiventures.com', lead_company: 'AI Ventures', status: 'opened', subject: '🚀 Join Our Exclusive AI Webinar - Jan 30th' },
    ];
    
    // Insert demo campaign leads
    for (const lead of demoLeads) {
      await sql`
        INSERT INTO campaign_leads (campaign_id, user_id, lead_id, lead_name, lead_email, lead_company, status, subject, sent_at, opens, clicks)
        VALUES (${lead.campaign_id}, 'admin', ${lead.lead_id}, ${lead.lead_name}, ${lead.lead_email}, ${lead.lead_company}, ${lead.status}, ${lead.subject}, ${Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000}, 0, 0)
        ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
          lead_name = EXCLUDED.lead_name,
          status = EXCLUDED.status
      `;
    }
    
    console.log(`✅ [DEMO SEED] Created ${demoCampaigns.length} campaigns and ${demoLeads.length} leads`);
    
    res.json({
      success: true,
      message: `Demo data created successfully!`,
      campaigns: demoCampaigns.length,
      leads: demoLeads.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ [DEMO SEED] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};