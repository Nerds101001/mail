// api/send-reminder.js — Morning digest email to contact@enginerds.in
// Called by Vercel cron at 8am daily (see vercel.json)
// Also callable manually: GET /api/send-reminder

const { get } = require("./_redis");
const nodemailer = require("nodemailer");

function daysDiff(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - Date.now()) / 86400000);
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const [rawLeads, rawClients, rawDeals, rawProfiles] = await Promise.all([
      get("crm:leads"),
      get("crm:clients"),
      get("crm:deals"),
      get("crm:profiles"),
    ]);

    const leads    = JSON.parse(rawLeads    || "[]");
    const clients  = JSON.parse(rawClients  || "[]");
    const deals    = JSON.parse(rawDeals    || "[]");
    const profiles = JSON.parse(rawProfiles || "[]");
    const today    = new Date().toDateString();

    // Build task sections
    const hotLeads = leads.filter(l =>
      (l.opens >= 2 || l.clicks >= 1) &&
      !["REPLIED","WON","LOST","UNSUBSCRIBED"].includes(l.pipelineStage)
    );

    const followups = leads.filter(l =>
      l.status === "SENT" && daysSince(l.lastSent) >= 2
    );

    const demosToday = deals.filter(d =>
      d.type === "DEMO" && d.demoDate && new Date(d.demoDate).toDateString() === today
    );

    const renewalsSoon = clients.filter(c =>
      c.renewalDate && daysDiff(c.renewalDate) !== null &&
      daysDiff(c.renewalDate) <= 30 && daysDiff(c.renewalDate) >= 0
    );

    const overduePayments = clients.filter(c => c.paymentStatus === "OVERDUE");

    // Build HTML email
    const section = (title, color, items, rowFn) => items.length === 0 ? "" : `
      <div style="margin-bottom:24px;">
        <h3 style="font-size:14px;font-weight:700;color:${color};margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">${title} (${items.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          ${items.map(rowFn).join("")}
        </table>
      </div>`;

    const row = (icon, title, detail) => `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px 4px;width:28px;">${icon}</td>
        <td style="padding:8px 4px;font-weight:600;color:#111;">${title}</td>
        <td style="padding:8px 4px;color:#666;">${detail}</td>
      </tr>`;

    const appUrl = process.env.APP_URL || "https://enginerdsmail.vercel.app";
    const dateStr = new Date().toLocaleDateString("en-IN", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

    const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:#0a0b0d;border-radius:8px 8px 0 0;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-family:monospace;font-size:14px;font-weight:700;color:#00e5a0;letter-spacing:2px;">ENGINERDS CRM</div>
    <div style="font-size:12px;color:#6b7280;">Daily Digest</div>
  </div>
  <div style="background:#fff;border-radius:0 0 8px 8px;padding:24px;">
    <h2 style="font-size:18px;margin:0 0 4px;color:#111;">Good morning! 👋</h2>
    <p style="font-size:13px;color:#666;margin:0 0 24px;">${dateStr}</p>

    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
      <div style="flex:1;min-width:120px;background:#fff8e1;border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#f59e0b;">${hotLeads.length}</div>
        <div style="font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:1px;">Hot Leads</div>
      </div>
      <div style="flex:1;min-width:120px;background:#e0f2fe;border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#0284c7;">${followups.length}</div>
        <div style="font-size:11px;color:#075985;text-transform:uppercase;letter-spacing:1px;">Follow-ups</div>
      </div>
      <div style="flex:1;min-width:120px;background:#dcfce7;border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#16a34a;">${demosToday.length}</div>
        <div style="font-size:11px;color:#14532d;text-transform:uppercase;letter-spacing:1px;">Demos Today</div>
      </div>
      <div style="flex:1;min-width:120px;background:#fee2e2;border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#dc2626;">${overduePayments.length}</div>
        <div style="font-size:11px;color:#7f1d1d;text-transform:uppercase;letter-spacing:1px;">Overdue</div>
      </div>
    </div>

    ${section("🔥 Hot Leads — Call Now", "#dc2626", hotLeads, l =>
      row("🔥", l.name, `${l.company||l.email} — ${l.opens||0} opens, ${l.clicks||0} clicks`)
    )}
    ${section("📞 Demos Today", "#7c3aed", demosToday, d =>
      row("📞", d.clientName||d.leadName, `${d.demoTime||"Time TBD"} — ${d.notes||""}`)
    )}
    ${section("🔄 Renewals Due Soon", "#d97706", renewalsSoon, c =>
      row("🔄", c.name, `${c.software||""} — expires in ${daysDiff(c.renewalDate)} days`)
    )}
    ${section("💰 Overdue Payments", "#dc2626", overduePayments, c =>
      row("💰", c.name, `${c.software||""} — ₹${c.amount||0} pending`)
    )}
    ${section("📧 Follow-ups Due", "#0284c7", followups.slice(0,10), l =>
      row("📧", l.name, `${l.company||l.email} — sent ${daysSince(l.lastSent)} days ago`)
    )}

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;text-align:center;">
      <a href="${appUrl}" style="display:inline-block;background:#00e5a0;color:#000;padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;">Open CRM Dashboard →</a>
    </div>
  </div>
  <div style="text-align:center;font-size:11px;color:#999;margin-top:12px;">Enginerds Tech Solution · Auto-generated daily digest</div>
</div>
</body></html>`;

    // Send via first active SMTP profile
    const smtpProfile = profiles.find(p => p.type === "smtp" && p.active);
    if (!smtpProfile) {
      return res.json({ ok: false, reason: "No active SMTP profile to send reminder" });
    }

    const transporter = nodemailer.createTransport({
      host: smtpProfile.host,
      port: parseInt(smtpProfile.port),
      secure: !!smtpProfile.secure,
      auth: { user: smtpProfile.user, pass: smtpProfile.pass },
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from: `"Enginerds CRM" <${smtpProfile.user}>`,
      to: "contact@enginerds.in",
      subject: `📋 Daily CRM Digest — ${hotLeads.length} hot leads, ${demosToday.length} demos today`,
      html,
    });

    res.json({ ok: true, sent: true, tasks: { hotLeads: hotLeads.length, followups: followups.length, demos: demosToday.length, renewals: renewalsSoon.length } });
  } catch (err) {
    console.error("send-reminder error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
