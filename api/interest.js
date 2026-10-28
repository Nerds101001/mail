// api/interest.js — Handles Interested / Not Interested button clicks from campaign emails
// These are SEPARATE from the tracking system (opens/clicks).
// We NEVER touch: simple_tracking, tracking_events, tracking columns in campaign_leads.

const { getSql }   = require('./_db');
const { optOut }   = require('./_optout');
const { confirmPage, donePage, errorPage } = require('./_optoutPages');

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

// ── Pages served to the lead's browser (see _optoutPages.js) ─────────────────
// The link in the email only OPENS a confirmation page; the change is made by the page's button,
// which POSTs back here. Mail-security scanners open every link in a message — before this they
// clicked "Interested" and "Not Interested" within 0.13 s of each other and opted people out.
function confirmationPage(action) {
  const isDemo = action === 'demo';
  return donePage({
    title: isDemo ? 'Thank you for your interest!' : 'Unsubscribed',
    icon: isDemo ? '🎉' : '✅',
    heading: isDemo ? "Great! We'll be in touch." : "You've been unsubscribed",
    text: isDemo ? 'Our team will reach out to schedule a demo for you soon.' : "You won't receive any more emails from us. We respect your decision.",
  });
}

function askPage(action, leadId, campaignId) {
  const isDemo = action === 'demo';
  const postTo = `/api/interest?action=${action}&lead=${encodeURIComponent(leadId)}${campaignId ? `&campaign=${encodeURIComponent(campaignId)}` : ''}`;
  return confirmPage({
    title: isDemo ? 'Confirm your interest' : 'Unsubscribe',
    icon: isDemo ? '🙋' : '✉️',
    heading: isDemo ? 'Would you like us to get in touch?' : 'Stop emails from us?',
    text: isDemo ? 'Press the button and our team will contact you to arrange a demo.' : "Press the button and we won't send you any more emails.",
    button: isDemo ? "Yes, I'm interested" : 'Yes, unsubscribe me',
    color: isDemo ? '#059669' : '#475569',
    postTo,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const { action, lead: leadId, campaign: campaignId } = req.query;

  if (!leadId || !action) {
    return res.status(400).send(errorPage('This link is incomplete.'));
  }
  if (action !== 'demo' && action !== 'unsub') {
    return res.status(400).send(errorPage('Unknown action.'));
  }

  // Opening the link (a person OR a scanner): show the question, change nothing.
  if (req.method !== 'POST') {
    return res.send(askPage(action, String(leadId), campaignId ? String(campaignId) : ''));
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
      // One durable opt-out (see _optout.js): blocks every future send to this address in every
      // campaign and route, shows up in the Unsubscribes list, and moves the lead's status AND
      // pipeline stage to UNSUBSCRIBED. If the address can't be determined this THROWS → the
      // visitor gets an error page instead of a false "you've been unsubscribed".
      await optOut({ leadId, campaignId, source: 'not-interested-button' });

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
      return res.status(400).send(errorPage('Unknown action.'));
    }

  } catch (err) {
    console.error('[Interest] Error:', err.message, err.stack);
    return res.status(500).send(errorPage());
  }
};
