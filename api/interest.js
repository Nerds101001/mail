const { get, set } = require('./_redis');
const { getSql } = require('./_db');

function confirmationPage(action) {
  const isDemo = action === 'demo';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isDemo ? 'Thank you for your interest!' : 'Unsubscribed'}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;}
  .card{background:#fff;border-radius:12px;padding:48px 40px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
  .icon{font-size:52px;margin-bottom:18px;}
  h2{color:#111827;font-size:22px;margin-bottom:10px;}
  p{color:#6b7280;font-size:14px;line-height:1.6;}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${isDemo ? '🎉' : '✅'}</div>
    <h2>${isDemo ? "Great! We'll be in touch." : "You've been unsubscribed"}</h2>
    <p>${isDemo ? 'Our team will reach out to schedule a demo for you soon.' : "You won't receive any more emails from us. We respect your decision."}</p>
  </div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { action, lead: leadId, campaign: campaignId } = req.query;

  if (!leadId || !action) {
    return res.status(400).send('<h2>Invalid request — missing parameters</h2>');
  }

  try {
    const sql = getSql();

    // Ensure interest_action column exists
    await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS interest_action TEXT`.catch(() => {});

    if (action === 'demo') {
      // 1. Update lead pipelineStage → DEMO in Redis
      try {
        const rawLeads = await get('crm:leads');
        if (rawLeads) {
          const leads = JSON.parse(rawLeads);
          const idx = leads.findIndex(l => l.id === leadId);
          if (idx !== -1) {
            leads[idx] = {
              ...leads[idx],
              pipelineStage: 'DEMO',
              notes: (leads[idx].notes || '') + `\n[${new Date().toISOString()}] Clicked Interested via email`,
            };
            await set('crm:leads', JSON.stringify(leads));
          }
        }
      } catch (e) { console.warn('[Interest] Redis update failed:', e.message); }

      // 2. Mark campaign_leads with interest_action = 'demo'
      if (campaignId) {
        await sql`
          UPDATE campaign_leads
          SET interest_action = 'demo'
          WHERE lead_id = ${leadId} AND campaign_id = ${campaignId}
        `.catch(() => {});
      } else {
        await sql`
          UPDATE campaign_leads
          SET interest_action = 'demo'
          WHERE lead_id = ${leadId}
          AND id = (SELECT id FROM campaign_leads WHERE lead_id = ${leadId} ORDER BY id DESC LIMIT 1)
        `.catch(() => {});
      }

      console.log(`[Interest] Lead ${leadId} marked as DEMO (campaign: ${campaignId || 'unknown'})`);
      return res.send(confirmationPage('demo'));

    } else if (action === 'unsub') {
      let resolvedEmail = null;
      try {
        const rawLeads = await get('crm:leads');
        if (rawLeads) {
          const leads = JSON.parse(rawLeads);
          const lead = leads.find(l => l.id === leadId);
          if (lead) {
            resolvedEmail = lead.email;
            const updated = leads.map(l =>
              l.id === leadId
                ? { ...l, status: 'UNSUBSCRIBED', notes: (l.notes || '') + `\n[${new Date().toISOString()}] Clicked Not Interested via email` }
                : l
            );
            await set('crm:leads', JSON.stringify(updated));
          }
        }
      } catch (e) { console.warn('[Interest] Redis update failed:', e.message); }

      if (resolvedEmail) {
        await set(`unsub:${resolvedEmail}`, 'true');
        await sql`
          UPDATE campaign_leads
          SET status = 'UNSUBSCRIBED', interest_action = 'unsub'
          WHERE lead_email = ${resolvedEmail} AND status IN ('SENT','REPLIED')
        `.catch(() => {});
      } else {
        await sql`
          UPDATE campaign_leads
          SET status = 'UNSUBSCRIBED', interest_action = 'unsub'
          WHERE lead_id = ${leadId} AND status IN ('SENT','REPLIED')
        `.catch(() => {});
      }

      console.log(`[Interest] Lead ${leadId} marked as UNSUBSCRIBED (email: ${resolvedEmail || 'unknown'})`);
      return res.send(confirmationPage('unsub'));

    } else {
      return res.status(400).send('<h2>Unknown action</h2>');
    }

  } catch (err) {
    console.error('[Interest] Error:', err);
    return res.status(500).send('<h2>Error processing your request. Please try again.</h2>');
  }
};
