// api/schedule-runner.js — Vercel Cron: execute due SCHEDULED campaigns
// Called every minute by Vercel Cron: GET /api/run-scheduled
const { get } = require("./_redis");
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  const appUrl = process.env.APP_URL || "https://enginerdsmail.vercel.app";
  const sql    = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
  const now    = Date.now();

  try {
    // ── Find all due SCHEDULED campaigns ─────────────────────────────────
    const dueCampaigns = await sql`
      SELECT * FROM campaigns
      WHERE status = 'SCHEDULED' AND scheduled_at IS NOT NULL AND scheduled_at <= ${now}
      ORDER BY scheduled_at ASC
      LIMIT 10
    `;

    if (dueCampaigns.length === 0) {
      return res.json({ ok: true, ran: 0, message: "No due campaigns" });
    }

    console.log(`🕐 [SCHEDULE-RUNNER] Found ${dueCampaigns.length} due campaign(s)`);

    let ran = 0;
    const results = [];

    for (const camp of dueCampaigns) {
      // Claim it immediately — prevents double-execution if cron fires twice
      const claimed = await sql`
        UPDATE campaigns SET status = 'RUNNING'
        WHERE id = ${camp.id} AND status = 'SCHEDULED'
        RETURNING id
      `;
      if (!claimed.length) {
        console.log(`⚠ [SCHEDULE-RUNNER] Campaign ${camp.id} already claimed — skipping`);
        continue;
      }

      const campResult = { id: camp.id, name: camp.name, sent: 0, failed: 0, skipped: 0 };

      try {
        // ── Parse stored config ──────────────────────────────────────────
        const cfgRaw = typeof camp.schedule_config === 'string'
          ? JSON.parse(camp.schedule_config || '{}')
          : (camp.schedule_config || {});

        const {
          cfg = {},
          variants = [],
          selectedSenders = [],
          selectedAttachments = [],
          usePersonalization = false,
        } = cfgRaw;

        const userId = camp.user_id;
        if (!userId) throw new Error("campaign.user_id is missing");

        // ── Load leads + profiles from Redis ────────────────────────────
        const leadsKey    = userId === 'admin' ? 'crm:leads'    : `crm:leads:${userId}`;
        const profilesKey = userId === 'admin' ? 'crm:profiles' : `crm:profiles:${userId}`;
        const [leadsRaw, profilesRaw] = await Promise.all([
          get(leadsKey),
          get(profilesKey),
        ]);
        const allLeads    = leadsRaw    ? JSON.parse(leadsRaw)    : [];
        const allProfiles = profilesRaw ? JSON.parse(profilesRaw) : [];

        // ── Filter target leads ──────────────────────────────────────────
        const fv = (cfg.filterVal || '').trim().toLowerCase();
        let targets;
        if      (cfg.target === 'all')      targets = allLeads.slice();
        else if (cfg.target === 'valid')    targets = allLeads.filter(l => l.status === 'VALID');
        else if (cfg.target === 'followup') targets = allLeads.filter(l => l.status === 'FOLLOW-UP');
        else if (cfg.target === 'hot')      targets = allLeads.filter(l => l.pipelineStage === 'HOT');
        else if (cfg.target === 'group')    targets = allLeads.filter(l => (l.group||'').toLowerCase() === fv);
        else                                targets = allLeads.filter(l => l.status === 'VALID');
        targets = targets.slice(0, cfg.batch || 30);

        // ── Resolve sender profiles ──────────────────────────────────────
        const senderProfiles = allProfiles.filter(p =>
          p.active && (
            selectedSenders.length === 0 ||
            selectedSenders.includes(p.user || p.email || '')
          )
        );
        if (!senderProfiles.length) throw new Error("No active sender profiles found for this user");

        console.log(`🚀 [SCHEDULE-RUNNER] Campaign "${camp.name}": ${targets.length} leads, ${senderProfiles.length} senders`);

        // ── Send emails ──────────────────────────────────────────────────
        for (let i = 0; i < targets.length; i++) {
          const l       = targets[i];
          const profile = senderProfiles[i % senderProfiles.length];
          const varIdx  = i % (variants.length || 1);

          // Build personalised content
          const nameToken    = l.name    || 'there';
          const companyToken = l.company || 'your company';
          const sub = (s) => (s || '')
            .replace(/\[Name\]/gi,    nameToken)
            .replace(/\[Company\]/gi, companyToken)
            .replace(/\[Role\]/gi,    l.role    || '')
            .replace(/their company/gi, companyToken);

          let subject, body;
          if (variants.length > 0) {
            const v = variants[varIdx];
            subject = sub(v.subject);
            body    = sub(v.body);
            if (usePersonalization && l.notes?.trim()) {
              const hook = `Given that ${companyToken} ${l.notes.trim().replace(/^(is |are |has |have )/i, '')},`;
              body = body.replace(/^(Hi [^\n,]+,\n\n)/i, `$1${hook} `);
            }
          } else {
            subject = `Question for ${l.company || 'your business'}`;
            body    = `Hi ${nameToken},\n\nI noticed ${companyToken} and thought we could help with your tech operations.\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`;
          }

          // Send via internal API
          const endpoint = profile.type === 'gmail'
            ? `${appUrl}/api/send-email`
            : `${appUrl}/api/send-smtp`;

          const payload = {
            leadId:     l.id,
            to:         l.email,
            subject,
            body,
            senderName: cfg.sender  || 'Enginerds Tech',
            replyTo:    cfg.replyTo || '',
            campaignId: camp.id,
            attachments: (selectedAttachments || []).map(id => ({ id })),
          };
          if (profile.type === 'smtp')  payload.smtpConfig = profile;
          if (profile.type === 'gmail') payload.gmailUser  = profile.user;

          let sendStatus = 'FAILED';
          try {
            const r    = await fetch(endpoint, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(payload),
            });
            const data = await r.json().catch(() => ({}));
            if      (data.skipped)       { sendStatus = 'SKIPPED'; campResult.skipped++; }
            else if (data.bounced)       { sendStatus = 'BOUNCED'; campResult.failed++;  }
            else if (r.ok && !data.error){ sendStatus = 'SENT';    campResult.sent++;    }
            else                         { campResult.failed++; }
          } catch(sendErr) {
            console.error(`❌ [SCHEDULE-RUNNER] Send error for ${l.email}:`, sendErr.message);
            campResult.failed++;
          }

          // Record in campaign_leads
          await sql`
            INSERT INTO campaign_leads
              (campaign_id, user_id, lead_id, lead_name, lead_email, lead_company,
               status, subject, body, sent_at, variant_index)
            VALUES
              (${camp.id}, ${userId}, ${l.id}, ${l.name||''}, ${l.email||''},
               ${l.company||''}, ${sendStatus}, ${subject||''}, ${body||''},
               ${Date.now()}, ${varIdx})
          `.catch(() => {});

          // Rate limiting (default 2 s between sends)
          if (i < targets.length - 1 && (cfg.rate || 0) > 0) {
            await new Promise(r => setTimeout(r, (cfg.rate) * 1000));
          }
        }

        // ── Mark COMPLETED ───────────────────────────────────────────────
        await sql`
          UPDATE campaigns SET
            status        = 'COMPLETED',
            total_sent    = ${campResult.sent},
            total_failed  = ${campResult.failed},
            total_skipped = ${campResult.skipped},
            stats         = ${JSON.stringify({
              sent:    campResult.sent,
              failed:  campResult.failed,
              skipped: campResult.skipped,
            })}::jsonb
          WHERE id = ${camp.id}
        `;

        console.log(`✅ [SCHEDULE-RUNNER] "${camp.name}" done — ${campResult.sent} sent, ${campResult.failed} failed`);
        ran++;
        results.push({ ...campResult, status: 'COMPLETED' });

      } catch (err) {
        console.error(`❌ [SCHEDULE-RUNNER] Campaign ${camp.id} failed:`, err.message);
        await sql`UPDATE campaigns SET status = 'FAILED' WHERE id = ${camp.id}`.catch(() => {});
        results.push({ ...campResult, status: 'FAILED', error: err.message });
      }
    }

    return res.json({ ok: true, ran, results });

  } catch (err) {
    console.error("❌ [SCHEDULE-RUNNER] Fatal:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
