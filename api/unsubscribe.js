const { get, set, ensureTable } = require('./_redis');
const { getSql } = require('./_db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id, email } = req.query;
  if (!id && !email) {
    return res.status(400).json({ error: 'Missing lead ID or Email' });
  }

  try {
    // 1. Mark as unsubscribed in the common leads list if it exists
    const rawLeads = await get('crm:leads');
    let resolvedEmail = email || null;
    if (rawLeads) {
      let leads = JSON.parse(rawLeads);
      let updated = false;

      leads.forEach(l => {
        if (l.id === id || l.email === email) {
          l.status = 'UNSUBSCRIBED';
          l.notes = (l.notes || '') + `\n[${new Date().toISOString()}] Unsubscribed via Link`;
          if (!resolvedEmail && l.email) resolvedEmail = l.email;
          updated = true;
        }
      });

      if (updated) {
        await set('crm:leads', JSON.stringify(leads));
      }
    }

    // 2. IMPORTANT: Set a permanent global unsubscribe flag for this email
    // This will be checked before EVERY send to prevent re-sending to this user.
    if (resolvedEmail) {
      await set(`unsub:${resolvedEmail}`, 'true');
      console.log(`Global unsubscribe set for: ${resolvedEmail}`);
    } else if (id) {
       // If only ID was provided, try to find the email to set the global flag
       const rawLeadsAgain = await get('crm:leads');
       const leadsAgain = JSON.parse(rawLeadsAgain || '[]');
       const lead = leadsAgain.find(l => l.id === id);
       if (lead && lead.email) {
         resolvedEmail = lead.email;
         await set(`unsub:${lead.email}`, 'true');
       }
    }

    // 3. Feature 8: Mark campaign_leads rows as UNSUBSCRIBED for analytics tracking
    if (resolvedEmail || id) {
      try {
        await ensureTable();
        const sql = getSql();
        // Mark the most recent SENT rows for this lead as UNSUBSCRIBED
        if (resolvedEmail) {
          await sql`
            UPDATE campaign_leads SET status = 'UNSUBSCRIBED'
            WHERE lead_email = ${resolvedEmail} AND status IN ('SENT','REPLIED')
          `.catch(() => {});
        } else if (id) {
          await sql`
            UPDATE campaign_leads SET status = 'UNSUBSCRIBED'
            WHERE lead_id = ${id} AND status IN ('SENT','REPLIED')
          `.catch(() => {});
        }
        console.log(`[UNSUB] campaign_leads updated for ${resolvedEmail || id}`);
      } catch(dbErr) {
        console.warn('[UNSUB] DB update failed (non-fatal):', dbErr.message);
      }
    }

    // Redirect to success page
    res.redirect('/unsubscribe.html?status=success');
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).json({ error: err.message });
  }
};
