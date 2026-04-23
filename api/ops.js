// api/ops.js — Unified ops endpoint with improved tracking
// GET /api/ops?type=tasks          → daily task list
// GET /api/ops?type=reminder       → send morning digest email
// GET /api/ops?type=tracking&ids=  → open/click stats (optimized)
// GET /api/ops?type=events&leadId= → detailed tracking events
// GET /api/ops?type=gmail-status   → Gmail connection status

const { get, set, getTrackingStats, getTrackingEvents } = require("./_redis");
const nodemailer = require("nodemailer");

async function safeGet(key, fallback) {
  try { const v = await get(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
}

function daysDiff(d)  { if(!d) return null; return Math.ceil((new Date(d)-Date.now())/86400000); }
function daysSince(d) { if(!d) return null; return Math.floor((Date.now()-new Date(d))/86400000); }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  const { type, ids, leadId } = req.query;

  // ── TRACKING STATS (simplified with direct database access) ──────────────────
  if (type === "tracking") {
    try {
      if (!ids) return res.json({});
      
      const leadIds = ids.split(",").filter(Boolean);
      console.log(`📊 [TRACKING STATS] Fetching stats for ${leadIds.length} leads`);
      
      // Direct database access with simple query
      const { neon } = require("@neondatabase/serverless");
      const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
      
      // Create table if it doesn't exist
      await sql`
        CREATE TABLE IF NOT EXISTS simple_tracking (
          lead_id TEXT PRIMARY KEY,
          opens INTEGER DEFAULT 0,
          clicks INTEGER DEFAULT 0,
          last_open BIGINT,
          last_click BIGINT
        )
      `;
      
      // Get stats for requested leads
      const rows = await sql`
        SELECT lead_id, opens, clicks 
        FROM simple_tracking 
        WHERE lead_id = ANY(${leadIds})
      `;
      
      const stats = {};
      rows.forEach(row => {
        stats[row.lead_id] = {
          opens: parseInt(row.opens) || 0,
          clicks: parseInt(row.clicks) || 0
        };
      });
      
      // Fill in missing leads with zero counts
      leadIds.forEach(id => {
        if (!stats[id]) {
          stats[id] = { opens: 0, clicks: 0 };
        }
      });
      
      console.log(`✅ [TRACKING STATS] Retrieved stats for ${Object.keys(stats).length} leads`);
      return res.json(stats);
      
    } catch(e) {
      console.error(`❌ [TRACKING STATS ERROR]:`, e.message);
      return res.status(500).json({ error: "Failed to fetch tracking stats" });
    }
  }

  // ── TRACKING EVENTS (detailed log with better error handling) ────────
  if (type === "events") {
    try {
      if (!leadId) return res.json({ events: [], error: "Missing leadId parameter" });
      
      console.log(`📋 [TRACKING EVENTS] Fetching events for lead ${leadId}`);
      const events = await getTrackingEvents(leadId, 100);
      
      console.log(`✅ [TRACKING EVENTS] Found ${events.length} events for lead ${leadId}`);
      return res.json({ events });
    } catch(e) {
      console.error(`❌ [TRACKING EVENTS ERROR] Lead ${leadId}:`, e.message);
      return res.json({ events: [], error: e.message });
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

  res.status(400).json({ error: "Invalid type" });
};
