// api/ops.js — Unified ops endpoint with improved tracking
// GET /api/ops?type=tasks             → daily task list
// GET /api/ops?type=reminder          → send morning digest email
// GET /api/ops?type=tracking&ids=     → open/click stats (optimized)
// GET /api/ops?type=events&leadId=    → detailed tracking events for one lead
// GET /api/ops?type=all-sends         → all campaign_leads rows with campaign names + tracking stats
// GET /api/ops?type=gmail-status      → Gmail connection status

const { get, set, getTrackingStats, getTrackingEvents, ensureTable } = require("./_redis");
const { neon } = require("@neondatabase/serverless");
const nodemailer = require("nodemailer");

async function safeGet(key, fallback) {
  try { const v = await get(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
}

function daysDiff(d)  { if(!d) return null; return Math.ceil((new Date(d)-Date.now())/86400000); }
function daysSince(d) { if(!d) return null; return Math.floor((Date.now()-new Date(d))/86400000); }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  const { type, ids, leadId } = req.query;

  // ── TRACKING STATS (using simplified tracking system) ──────────────────
  if (type === "tracking") {
    try {
      console.log(`📊 [OPS TRACKING] Request received:`, { type, ids, leadId, query: req.query });
      
      if (!ids) {
        console.log(`📊 [OPS TRACKING] No IDs provided, returning empty object`);
        return res.json({});
      }
      
      const leadIds = ids.split(",").filter(Boolean);
      console.log(`📊 [OPS TRACKING] Processing ${leadIds.length} lead IDs:`, leadIds);
      
      const stats = await getTrackingStats(leadIds);
      console.log(`📊 [OPS TRACKING] Retrieved stats:`, stats);
      
      console.log(`✅ [OPS TRACKING] Returning stats for ${Object.keys(stats).length} leads`);
      return res.json(stats);
      
    } catch(e) {
      console.error(`❌ [OPS TRACKING ERROR]:`, e.message, e.stack);
      return res.status(500).json({ error: "Failed to fetch tracking stats", details: e.message });
    }
  }

  // ── TRACKING EVENTS (detailed log with better error handling) ────────
  if (type === "events") {
    try {
      if (!leadId) return res.json({ events: [], error: "Missing leadId parameter" });
      const campaignId = req.query.campaignId || null;
      console.log(`📋 [TRACKING EVENTS] Fetching events for lead ${leadId} campaign ${campaignId||'all'}`);
      const events = await getTrackingEvents(leadId, campaignId, 100);
      console.log(`✅ [TRACKING EVENTS] Found ${events.length} events`);
      return res.json({ events });
    } catch(e) {
      console.error(`❌ [TRACKING EVENTS ERROR] Lead ${leadId}:`, e.message);
      return res.json({ events: [], error: e.message });
    }
  }

  // ── ALL SENDS (full campaign_leads view for Tracking page) ───────────
  if (type === "all-sends") {
    try {
      // ensureTable creates tracking_events (with campaign_id column) + all indexes.
      // Must run BEFORE the subqueries below reference tracking_events.
      await ensureTable();

      const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
      const campFilter = req.query.campaign || null;
      const rowLimit   = Math.min(parseInt(req.query.limit) || 1000, 2000);

      // Ensure app tables exist (safe no-ops if already created)
      await sql`CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at BIGINT, target TEXT, sender TEXT, total_sent INT DEFAULT 0, total_failed INT DEFAULT 0, total_skipped INT DEFAULT 0, stats JSONB DEFAULT '{}', brief JSONB DEFAULT '{}', variants JSONB DEFAULT '[]')`.catch(()=>{});
      await sql`CREATE TABLE IF NOT EXISTS campaign_leads (id SERIAL PRIMARY KEY, campaign_id TEXT, user_id TEXT, lead_id TEXT, lead_name TEXT, lead_email TEXT, lead_company TEXT, status TEXT DEFAULT 'sent', subject TEXT, body TEXT, sent_at BIGINT, variant_index INT DEFAULT 0)`.catch(()=>{});

      // Per-campaign opens/clicks via subquery on tracking_events (accurate per send,
      // not cumulative across all campaigns like simple_tracking would give)
      const [sends, campaigns] = await Promise.all([
        campFilter
          ? sql`
              SELECT cl.id, cl.campaign_id, cl.lead_id, cl.lead_name, cl.lead_email,
                     cl.lead_company, cl.status, cl.subject, cl.sent_at, cl.variant_index,
                     COALESCE(c.name,'Unknown Campaign') as campaign_name,
                     (SELECT COUNT(*) FROM tracking_events te
                      WHERE te.lead_id=cl.lead_id AND te.campaign_id=cl.campaign_id
                        AND te.event_type='open') as opens,
                     (SELECT COUNT(*) FROM tracking_events te
                      WHERE te.lead_id=cl.lead_id AND te.campaign_id=cl.campaign_id
                        AND te.event_type='click') as clicks
              FROM campaign_leads cl LEFT JOIN campaigns c ON cl.campaign_id=c.id
              WHERE cl.campaign_id=${campFilter}
              ORDER BY cl.sent_at DESC LIMIT ${rowLimit}
            `
          : sql`
              SELECT cl.id, cl.campaign_id, cl.lead_id, cl.lead_name, cl.lead_email,
                     cl.lead_company, cl.status, cl.subject, cl.sent_at, cl.variant_index,
                     COALESCE(c.name,'Unknown Campaign') as campaign_name,
                     (SELECT COUNT(*) FROM tracking_events te
                      WHERE te.lead_id=cl.lead_id AND te.campaign_id=cl.campaign_id
                        AND te.event_type='open') as opens,
                     (SELECT COUNT(*) FROM tracking_events te
                      WHERE te.lead_id=cl.lead_id AND te.campaign_id=cl.campaign_id
                        AND te.event_type='click') as clicks
              FROM campaign_leads cl LEFT JOIN campaigns c ON cl.campaign_id=c.id
              ORDER BY cl.sent_at DESC LIMIT ${rowLimit}
            `,
        sql`SELECT id, name, created_at FROM campaigns ORDER BY created_at DESC LIMIT 200`,
      ]);

      // COUNT(*) from Postgres arrives as string via neon driver — parse to int
      return res.json({
        sends: sends.map(s => ({ ...s, opens: parseInt(s.opens)||0, clicks: parseInt(s.clicks)||0 })),
        campaigns,
      });
    } catch(e) {
      console.error("[ALL-SENDS]", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GMAIL STATUS ──────────────────────────────────────────────────────
  if (type === "gmail-status") {
    try {
      const email = await get("gmail:email");
      const expiresAt = parseInt(await get("gmail:expires_at")||"0");
      return res.json({ connected: !!email, email: email||null, tokenExpired: expiresAt>0&&Date.now()>expiresAt });
    } catch(e) { return res.json({ connected: false, email: null }); }
  }

  // ── DAILY TASKS ───────────────────────────────────────────────────────
  if (type === "tasks") {
    const [leads, clients, deals] = await Promise.all([
      safeGet("crm:leads",[]), safeGet("crm:clients",[]), safeGet("crm:deals",[]),
    ]);
    const tasks = [];
    const today = new Date().toDateString();

    leads.filter(l=>(l.opens>=2||l.clicks>=1)&&!["REPLIED","WON","LOST","UNSUBSCRIBED"].includes(l.pipelineStage))
      .forEach(l=>tasks.push({priority:"HIGH",type:"CALL",icon:"🔥",title:`Call hot lead: ${l.name}`,detail:`${l.company||l.email} — ${l.opens||0} opens, ${l.clicks||0} clicks`,email:l.email,name:l.name}));

    leads.filter(l=>l.status==="SENT"&&daysSince(l.lastSent)>=2)
      .forEach(l=>tasks.push({priority:"MEDIUM",type:"FOLLOWUP",icon:"📧",title:`Follow up: ${l.name}`,detail:`Sent ${daysSince(l.lastSent)} days ago`,email:l.email,name:l.name}));

    deals.filter(d=>d.type==="DEMO"&&d.demoDate&&new Date(d.demoDate).toDateString()===today)
      .forEach(d=>tasks.push({priority:"HIGH",type:"DEMO",icon:"📞",title:`Demo today: ${d.clientName||d.leadName}`,detail:`${d.demoTime||"Time TBD"}`,name:d.clientName||d.leadName}));

    clients.filter(c=>c.renewalDate&&daysDiff(c.renewalDate)!==null&&daysDiff(c.renewalDate)<=30&&daysDiff(c.renewalDate)>=0)
      .forEach(c=>tasks.push({priority:daysDiff(c.renewalDate)<=7?"HIGH":"MEDIUM",type:"RENEWAL",icon:"🔄",title:`Renewal due: ${c.name}`,detail:`${c.software||""} — ${daysDiff(c.renewalDate)} days left`,email:c.email,name:c.name}));

    clients.filter(c=>c.paymentStatus==="OVERDUE")
      .forEach(c=>tasks.push({priority:"HIGH",type:"PAYMENT",icon:"💰",title:`Overdue payment: ${c.name}`,detail:`${c.software||""} — ₹${c.amount||0}`,email:c.email,name:c.name}));

    tasks.sort((a,b)=>({HIGH:0,MEDIUM:1,LOW:2}[a.priority]-{HIGH:0,MEDIUM:1,LOW:2}[b.priority]));
    return res.json({ tasks, generatedAt: new Date().toISOString(), counts:{total:tasks.length,high:tasks.filter(t=>t.priority==="HIGH").length} });
  }

  // ── SEND REMINDER ─────────────────────────────────────────────────────
  if (type === "reminder") {
    const [leads, clients, deals, profiles] = await Promise.all([
      safeGet("crm:leads",[]), safeGet("crm:clients",[]), safeGet("crm:deals",[]), safeGet("crm:profiles",[]),
    ]);
    const today = new Date().toDateString();
    const hotLeads      = leads.filter(l=>(l.opens>=2||l.clicks>=1)&&!["WON","LOST","UNSUBSCRIBED"].includes(l.pipelineStage));
    const followups     = leads.filter(l=>l.status==="SENT"&&daysSince(l.lastSent)>=2);
    const demosToday    = deals.filter(d=>d.type==="DEMO"&&d.demoDate&&new Date(d.demoDate).toDateString()===today);
    const renewalsSoon  = clients.filter(c=>c.renewalDate&&daysDiff(c.renewalDate)!==null&&daysDiff(c.renewalDate)<=30&&daysDiff(c.renewalDate)>=0);
    const overduePayments = clients.filter(c=>c.paymentStatus==="OVERDUE");

    const smtpProfile = profiles.find(p=>p.type==="smtp"&&p.active);
    if (!smtpProfile) return res.json({ ok: false, reason: "No active SMTP profile" });

    const appUrl = process.env.APP_URL || "https://enginerdsmail.vercel.app";
    const row = (icon,title,detail) => `<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:8px 4px;width:28px;">${icon}</td><td style="padding:8px 4px;font-weight:600;color:#111;">${title}</td><td style="padding:8px 4px;color:#666;">${detail}</td></tr>`;
    const section = (title,color,items,fn) => !items.length?"":`<div style="margin-bottom:24px;"><h3 style="font-size:14px;font-weight:700;color:${color};margin:0 0 10px;text-transform:uppercase;">${title} (${items.length})</h3><table style="width:100%;border-collapse:collapse;font-size:13px;">${items.map(fn).join("")}</table></div>`;

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:#0a0b0d;border-radius:8px 8px 0 0;padding:20px 24px;"><div style="font-family:monospace;font-size:14px;font-weight:700;color:#00e5a0;letter-spacing:2px;">ENGINERDS CRM — Daily Digest</div></div>
  <div style="background:#fff;border-radius:0 0 8px 8px;padding:24px;">
    <h2 style="font-size:18px;margin:0 0 4px;">Good morning! 👋</h2>
    <p style="font-size:13px;color:#666;margin:0 0 24px;">${new Date().toLocaleDateString("en-IN",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
      ${[["🔥",hotLeads.length,"Hot Leads","#fff8e1","#f59e0b"],["📞",demosToday.length,"Demos Today","#dcfce7","#16a34a"],["🔄",renewalsSoon.length,"Renewals","#fef3c7","#d97706"],["💰",overduePayments.length,"Overdue","#fee2e2","#dc2626"]]
        .map(([icon,n,label,bg,color])=>`<div style="flex:1;min-width:100px;background:${bg};border-radius:8px;padding:14px;text-align:center;"><div style="font-size:24px;font-weight:700;color:${color};">${n}</div><div style="font-size:11px;color:${color};text-transform:uppercase;">${label}</div></div>`).join("")}
    </div>
    ${section("🔥 Hot Leads","#dc2626",hotLeads,l=>row("🔥",l.name,`${l.company||l.email} — ${l.opens||0} opens`))}
    ${section("📞 Demos Today","#7c3aed",demosToday,d=>row("📞",d.clientName||d.leadName,d.demoTime||"Time TBD"))}
    ${section("🔄 Renewals Due","#d97706",renewalsSoon,c=>row("🔄",c.name,`${c.software||""} — ${daysDiff(c.renewalDate)} days`))}
    ${section("💰 Overdue Payments","#dc2626",overduePayments,c=>row("💰",c.name,`₹${c.amount||0} pending`))}
    ${section("📧 Follow-ups","#0284c7",followups.slice(0,10),l=>row("📧",l.name,`Sent ${daysSince(l.lastSent)} days ago`))}
    <div style="margin-top:24px;text-align:center;"><a href="${appUrl}" style="background:#00e5a0;color:#000;padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;">Open CRM →</a></div>
  </div>
</div></body></html>`;

    const transporter = nodemailer.createTransport({ host:smtpProfile.host, port:parseInt(smtpProfile.port), secure:!!smtpProfile.secure, auth:{user:smtpProfile.user,pass:smtpProfile.pass}, tls:{rejectUnauthorized:false} });
    await transporter.sendMail({ from:`"Enginerds CRM" <${smtpProfile.user}>`, to:"contact@enginerds.in", subject:`📋 Daily Digest — ${hotLeads.length} hot leads, ${demosToday.length} demos today`, html });
    return res.json({ ok: true });
  }

  // ── AI EMAIL GENERATION ───────────────────────────────────────────────
  if (type === "generate-ai" && req.method === "POST") {
    try {
      const { name, company, role, category, apiKey, customPrompt, count = 1, brief = {} } = req.body;

      if (!apiKey) return res.status(400).json({ error: 'NVIDIA API key is required' });

      const variantCount = Math.min(Math.max(1, parseInt(count) || 1), 15);
      console.log(`🤖 [AI] Generating ${variantCount} variants — product: ${brief.product || 'n/a'}`);

      // Build the seller context block from campaign brief
      const sellerContext = [
        brief.product      ? `Product/Service: ${brief.product}` : null,
        brief.industries   ? `Target Industries: ${brief.industries}` : null,
        brief.problems     ? `Problems We Solve: ${brief.problems}` : null,
        brief.solutions    ? `Our Solutions: ${brief.solutions}` : null,
        brief.technologies ? `Technologies/USP: ${brief.technologies}` : null,
        category           ? `Recipient Industry: ${category}` : null,
      ].filter(Boolean).join('\n');

      // 15 distinct sales-pitch approaches
      const approaches = [
        { name:'Pain-Agitate-Solve',          hook:'Describe one painful problem → amplify the business cost → reveal your fix',       cta:'ask for a 15-min call' },
        { name:'ROI Lead',                     hook:'Open with a specific metric (%, time, money) your clients gain → prove it → invite',cta:'offer a free audit or demo' },
        { name:'Burning Question',             hook:'Open with a sharp question that makes them think about a gap they have',           cta:'offer to show the answer on a call' },
        { name:'Before & After',               hook:'Paint the painful "before" state → contrast with the better "after" your product creates', cta:'ask if they want the same' },
        { name:'Industry Insight',             hook:'Share a real trend in their sector → connect it to the risk of doing nothing → position your offer', cta:'offer a strategy session' },
        { name:'Competitor Gap',               hook:'Mention what top players in their industry are doing that most businesses miss → offer to bridge that gap', cta:'request a quick intro call' },
        { name:'Cost of Inaction',             hook:'Quantify what it costs them every month to NOT solve this problem → make delay feel expensive', cta:'offer a no-obligation chat' },
        { name:'Social Proof',                 hook:'Reference a specific type of company you helped → result they got → why this matters for the prospect', cta:'offer to share case study' },
        { name:'Founder-to-Founder',           hook:'Direct, peer-to-peer tone — one business person to another — share a core belief about their problem', cta:'ask a direct yes/no question' },
        { name:'The Challenge',                hook:'Challenge a common assumption they likely hold → present a counterintuitive insight → position your solution', cta:'offer to prove it in 15 min' },
        { name:'Compliment + Gap',             hook:'Genuine compliment about something specific about their business → pivot to a gap → your bridge', cta:'ask for feedback or a reaction' },
        { name:'Quick Win Offer',              hook:'Lead with an immediate concrete value you can deliver before they commit anything', cta:'invite them to claim the quick win' },
        { name:'Data-Driven Urgency',          hook:'Use an industry statistic to create mild urgency → connect to their situation → your solution', cta:'invite them to act before competitors do' },
        { name:'Story-Based',                  hook:'2-sentence mini story about a client who had their exact problem → outcome → bridge to prospect', cta:'ask if this story sounds familiar' },
        { name:'Direct Pitch',                 hook:'No fluff — state exactly what you do, who you help, what result they get, why now',  cta:'clear, confident ask for a call time' },
      ];

      // Build one prompt per variant, then fire ALL in parallel — avoids Vercel timeout
      function buildPrompt(i) {
        const approach    = approaches[i % approaches.length];
        const temperature = Math.min(0.55 + i * 0.06, 1.0);

        const systemPrompt = `You are a world-class B2B sales email copywriter. Your emails consistently get 30%+ reply rates because they feel human, are razor-sharp on the prospect's pain, and make a compelling case for action.

SELLER CONTEXT (use this to make the pitch specific and credible):
${sellerContext || 'No brief provided — write a general outreach email for a tech company.'}

RECIPIENT:
- Name: ${name || '[Name]'}
- Company: ${company || '[Company]'}
- Role: ${role || 'decision maker'}
${customPrompt ? `\nEXTRA INSTRUCTIONS: ${customPrompt}` : ''}

THIS VARIANT (#${i + 1} of ${variantCount}) — Approach: "${approach.name}"
Technique: ${approach.hook}
Call-to-action style: ${approach.cta}

RULES:
1. Length: 120–180 words total (short emails get more replies)
2. Subject line: 5–8 words, intriguing, not clickbait, no ALL CAPS
3. Opening: never start with "I hope this email finds you well" or "My name is"
4. Body: make the problem/solution SPECIFIC — use details from the seller context above
5. Tone: confident but not arrogant, human not corporate
6. CTA: one single clear ask — make it easy to say yes
7. Signature: always end with "Best,\nPawan Kumar\nEnginerds Tech Solution"

CRITICAL FORMATTING RULE — this is the most important rule:
The "body" field MUST use this EXACT structure with BLANK LINES (\\n\\n) between every section:

"Hi [Name],\\n\\n[Opening hook sentence.]\\n\\n[2-3 sentence body with problem and solution.]\\n\\n[One CTA sentence.]\\n\\nBest,\\nPawan Kumar\\nEnginerds Tech Solution"

NEVER write the whole email as one paragraph. ALWAYS put \\n\\n between the greeting, body paragraphs, CTA, and signature. The greeting "Hi [Name]," must be on its own line, the signature must be on its own lines.

Return ONLY valid JSON. No markdown. No code fences. Exactly:
{"subject":"...","body":"..."}`;

        const userPrompt = `Write variant ${i + 1} using the "${approach.name}" approach. Subject and opening must differ from all other variants.`;

        return { approach, temperature, systemPrompt, userPrompt };
      }

      async function fetchVariant(i) {
        const { approach, temperature, systemPrompt, userPrompt } = buildPrompt(i);
        try {
          const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'meta/llama-3.1-405b-instruct',
              messages: [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }],
              temperature,
              max_tokens: 600,
              top_p: 0.95,
            })
          });

          if (!response.ok) throw new Error(`NVIDIA API ${response.status}`);
          const data = await response.json();
          if (!data.choices?.[0]?.message) throw new Error('Empty NVIDIA response');

          const raw = data.choices[0].message.content;
          let result;
          try {
            result = JSON.parse(raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim());
          } catch {
            const subMatch = raw.match(/subject[:\s]+["']?(.+?)["']?\n/i);
            result = {
              subject: subMatch ? subMatch[1].trim() : `Opportunity for ${company || '[Company]'}`,
              body:    raw.replace(/subject[:\s]+.+?\n/i,'').trim(),
            };
          }

          result.subject  = (result.subject || '').replace(/^["']|["']$/g,'').trim() || `Opportunity for ${company || '[Company]'}`;
          result.body     = (result.body    || '').replace(/^["']|["']$/g,'').trim() || `Hi ${name || '[Name]'},\n\nWould you be open to a quick 15-minute chat?\n\nBest,\nPawan Kumar\nEnginerds Tech Solution`;
          result.approach = approach.name;

          console.log(`✅ Variant ${i+1} [${approach.name}]:`, result.subject.substring(0, 60));
          return result;

        } catch (err) {
          console.error(`❌ Variant ${i+1} fallback:`, err.message);
          const prob = brief.problems  || 'operational inefficiencies';
          const sol  = brief.solutions || 'smart automation';
          const prod = brief.product   || 'our solution';
          const fallbacks = [
            { subject:`Is ${company||'[Company]'} losing time to ${prob.split(',')[0].trim().toLowerCase()}?`,
              body:`Hi ${name||'[Name]'},\n\nMost ${category||'businesses'} we talk to lose 10–20 hours a week to ${prob.split(',')[0].trim().toLowerCase()}.\n\nWe built ${prod} to fix exactly this — ${sol.split(',')[0].trim().toLowerCase()}. Clients typically see results in under 60 days.\n\nWould a quick 15-min call make sense this week?\n\nBest,\nPawan Kumar\nEnginerds Tech Solution` },
            { subject:`Quick ROI question for ${company||'[Company]'}`,
              body:`Hi ${name||'[Name]'},\n\nIf I could show you how ${company||'[Company]'} could reduce ${prob.split(',')[0].trim().toLowerCase()} by 30%, would that be worth 15 minutes?\n\nWe've helped similar companies do this using ${sol.split(',').slice(0,2).join(' and ').toLowerCase()}.\n\nDoes Thursday or Friday work for a quick call?\n\nBest,\nPawan Kumar\nEnginerds Tech Solution` },
            { subject:`What top ${category||'companies'} are doing differently`,
              body:`Hi ${name||'[Name]'},\n\nThe fastest-growing ${category||'businesses'} have one thing in common: they've stopped tolerating ${prob.split(',')[0].trim().toLowerCase()}.\n\nWe help companies like ${company||'[Company]'} make that shift with ${prod}.\n\nWorth a 15-min look?\n\nBest,\nPawan Kumar\nEnginerds Tech Solution` },
          ];
          return { ...fallbacks[i % fallbacks.length], approach: approach.name, fallback: true };
        }
      }

      // Fire all variant requests in parallel — stays within Vercel's timeout
      const variantPromises = Array.from({ length: variantCount }, (_, i) => fetchVariant(i));
      const variants = await Promise.all(variantPromises);

      console.log(`✅ [AI] Done — ${variants.length} variants ready`);
      return res.json({ variants, count: variants.length });

    } catch (error) {
      console.error('❌ AI Generation fatal error:', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  res.status(400).json({ error: "Invalid type" });
};
