// api/interest.js — Handles Interested / Not Interested button clicks from campaign emails
// These are SEPARATE from the tracking system (opens/clicks).
// We NEVER touch: simple_tracking, tracking_events, tracking columns in campaign_leads.

const { get, set } = require('./_redis');
const { getSql }   = require('./_db');

// ── Find a lead across ALL user namespaces ────────────────────────────────────
// First tries the campaign's own user_id (fastest), then scans all crm:leads* keys.
async function findLeadInStore(leadId, campaignId, sql) {
  // 1. If we have a campaignId, look up the campaign's user_id → target key directly
  if (campaignId) {
    try {
      const camps = await sql`SELECT user_id FROM campaigns WHERE id = ${campaignId} LIMIT 1`;
      if (camps.length) {
        const userId = camps[0].user_id || 'admin';
        const lKey   = userId === 'admin' ? 'crm:leads' : `crm:leads:${userId}`;
        const rows   = await sql`SELECT value FROM kv_store WHERE key = ${lKey} LIMIT 1`;
        if (rows.length && rows[0].value) {
          const leads = JSON.parse(rows[0].value);
          const lead  = Array.isArray(leads) ? leads.find(l => l.id === leadId) : null;
          if (lead) return { lead, leads, lKey };
        }
      }
    } catch (e) { console.warn('[Interest] campaign lookup failed:', e.message); }
  }

  // 2. Fallback: scan ALL crm:leads* keys (catches any namespace)
  try {
    const allKeys = await sql`SELECT key, value FROM kv_store WHERE key LIKE 'crm:leads%'`;
    for (const row of allKeys) {
      try {
        const leads = JSON.parse(row.value);
        if (!Array.isArray(leads)) continue;
        const lead = leads.find(l => l.id === leadId);
        if (lead) return { lead, leads, lKey: row.key };
      } catch {}
    }
  } catch (e) { console.warn('[Interest] namespace scan failed:', e.message); }

  return null; // lead not found in any namespace
}

// ── Confirmation page served to the lead's browser ───────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { action, lead: leadId, campaign: campaignId } = req.query;

  if (!leadId || !action) {
    return res.status(400).send('<h2>Invalid request — missing parameters</h2>');
  }

  try {
    const sql = getSql();

    // Ensure interest_action column exists (non-blocking, safe to re-run)
    await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS interest_action TEXT`.catch(() => {});

    // ── Find the lead in kv_store ─────────────────────────────────────────────
    const found = await findLeadInStore(leadId, campaignId, sql);

    // ── INTERESTED → stage moves to DEMO ─────────────────────────────────────
    if (action === 'demo') {
      if (found) {
        const { lead, leads, lKey } = found;

        // Only update pipelineStage — do NOT touch opens, clicks, status, or any tracking field
        const updatedLeads = leads.map(l =>
          l.id === leadId
            ? {
                ...l,
                pipelineStage: 'DEMO',
                // Append a note so there's a human-readable audit trail
                notes: (l.notes || '') + `\n[${new Date().toISOString()}] Clicked "Interested" via campaign email`,
              }
            : l
        );

        await sql`UPDATE kv_store SET value = ${JSON.stringify(updatedLeads)} WHERE key = ${lKey}`.catch(() => {});
        console.log(`[Interest] ✅ Lead ${leadId} stage → DEMO  (key: ${lKey})`);
      } else {
        console.warn(`[Interest] ⚠️  Lead ${leadId} not found in any namespace — skipping kv update`);
      }

      // Record interest_action in campaign_leads — ONLY the interest_action column.
      // Do NOT update opens, clicks, status, subject, body, or any tracking column.
      if (campaignId) {
        await sql`
          UPDATE campaign_leads
          SET interest_action = 'demo'
          WHERE lead_id = ${leadId} AND campaign_id = ${campaignId}
        `.catch(() => {});
      } else {
        // No campaign context — update the most recent row only
        await sql`
          UPDATE campaign_leads
          SET interest_action = 'demo'
          WHERE id = (
            SELECT id FROM campaign_leads
            WHERE lead_id = ${leadId}
            ORDER BY id DESC LIMIT 1
          )
        `.catch(() => {});
      }

      console.log(`[Interest] ✅ interest_action=demo recorded for lead ${leadId} (camp: ${campaignId || 'latest'})`);
      return res.send(confirmationPage('demo'));

    // ── NOT INTERESTED → unsubscribe ─────────────────────────────────────────
    } else if (action === 'unsub') {
      let resolvedEmail = null;

      if (found) {
        const { lead, leads, lKey } = found;
        resolvedEmail = lead.email;

        // Update the lead: mark status UNSUBSCRIBED + append note.
        // Do NOT touch pipelineStage, opens, clicks, or any tracking field.
        const updatedLeads = leads.map(l =>
          l.id === leadId
            ? {
                ...l,
                status: 'UNSUBSCRIBED',
                notes: (l.notes || '') + `\n[${new Date().toISOString()}] Clicked "Not Interested" via campaign email — unsubscribed`,
              }
            : l
        );

        await sql`UPDATE kv_store SET value = ${JSON.stringify(updatedLeads)} WHERE key = ${lKey}`.catch(() => {});
        console.log(`[Interest] ✅ Lead ${leadId} status → UNSUBSCRIBED  (key: ${lKey}, email: ${resolvedEmail})`);
      } else {
        console.warn(`[Interest] ⚠️  Lead ${leadId} not found in any namespace — skipping kv update`);
      }

      // Set the global unsub flag so future campaigns skip this email address
      if (resolvedEmail) {
        await set(`unsub:${resolvedEmail}`, 'true');
        console.log(`[Interest] ✅ unsub:${resolvedEmail} = true`);
      }

      // Record interest_action in campaign_leads — ONLY the interest_action column.
      // We deliberately do NOT update campaign_leads.status here because:
      //   - status tracks whether the email was sent/failed/pending (delivery state)
      //   - interest_action tracks what the lead chose to do after receiving it
      // These are orthogonal — leave delivery status intact.
      if (campaignId) {
        await sql`
          UPDATE campaign_leads
          SET interest_action = 'unsub'
          WHERE lead_id = ${leadId} AND campaign_id = ${campaignId}
        `.catch(() => {});
      } else {
        await sql`
          UPDATE campaign_leads
          SET interest_action = 'unsub'
          WHERE id = (
            SELECT id FROM campaign_leads
            WHERE lead_id = ${leadId}
            ORDER BY id DESC LIMIT 1
          )
        `.catch(() => {});
      }

      console.log(`[Interest] ✅ interest_action=unsub recorded for lead ${leadId} (camp: ${campaignId || 'latest'})`);
      return res.send(confirmationPage('unsub'));

    } else {
      return res.status(400).send('<h2>Unknown action</h2>');
    }

  } catch (err) {
    console.error('[Interest] Error:', err.message, err.stack);
    return res.status(500).send('<h2>Error processing your request. Please try again.</h2>');
  }
};
