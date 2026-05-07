// api/send-test.js — One-shot test email sender (auto-removes itself after use)
// GET /api/send-test?to=email@example.com
const nodemailer = require("nodemailer");
const { get, set, trackOpen, getTrackingEvents, getDb } = require("./_redis");

const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  const to = req.query.to || "csenerds@gmail.com";
  const leadId   = `test_send_${Date.now()}`;
  const campId   = `camp_test_send_${Date.now()}`;
  const steps    = [];
  const pass     = (n, d = "") => steps.push({ ok: true,  name: n, detail: d });
  const fail     = (n, d = "") => steps.push({ ok: false, name: n, detail: d });

  // 1. Load SMTP profile from kv_store (includes password)
  let smtpProfile;
  try {
    const raw = await get("crm:profiles");
    const profiles = raw ? JSON.parse(raw) : [];
    smtpProfile = profiles.find(p => p.type === "smtp" && p.active);
    if (!smtpProfile) return res.status(400).json({ error: "No active SMTP profile found in DB" });
    if (!smtpProfile.pass && !smtpProfile.password) {
      return res.status(400).json({ error: "SMTP profile has no password stored" });
    }
    pass("SMTP profile loaded", `host=${smtpProfile.host} user=${smtpProfile.user}`);
  } catch (e) {
    return res.status(500).json({ error: "Failed to load profiles: " + e.message });
  }

  // 2. Build tracking pixel URL
  const pixelUrl   = `${APP_URL}/api/track-open?id=${leadId}&cid=${campId}`;
  const unsubUrl   = `${APP_URL}/api/unsubscribe?email=${encodeURIComponent(to)}&id=${leadId}`;
  const htmlBody   = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#000;background:#fff;padding:20px;">
  <p>Hi,</p>
  <p>This is a <strong>tracking test email</strong> sent from <strong>${smtpProfile.user}</strong>.</p>
  <p>When you open this email, the tracking pixel below will fire and record an open event in the database.</p>
  <p>Pixel URL: <code style="font-size:11px;color:#666;">${pixelUrl}</code></p>
  <p style="color:#888;font-size:12px;">Lead ID: ${leadId} | Campaign: ${campId}</p>
  <p style="margin-top:24px;font-size:11px;color:#aaa;">
    <a href="${unsubUrl}" style="color:#aaa;">Unsubscribe</a>
  </p>
  <img src="${pixelUrl}" width="1" height="1" alt="" border="0" style="display:block;width:1px;height:1px;opacity:0.01;">
</body></html>`;

  // 3. Set scanner guard key BEFORE sending
  try {
    await set(`email:guard:${leadId}`, String(Date.now()), 60);
    pass("Guard key set");
  } catch (e) {
    fail("Guard key", e.message);
  }

  // 4. Send email
  try {
    const transporter = nodemailer.createTransport({
      host:              smtpProfile.host,
      port:              parseInt(smtpProfile.port),
      secure:            !!smtpProfile.secure,
      auth:              { user: smtpProfile.user, pass: smtpProfile.pass || smtpProfile.password },
      tls:               { rejectUnauthorized: false },
      connectionTimeout: 15000,
      greetingTimeout:   15000,
    });
    const info = await transporter.sendMail({
      from:    `"Enginerds Test" <${smtpProfile.user}>`,
      to,
      subject: `📬 Tracking Test — open to verify [${new Date().toLocaleTimeString()}]`,
      html:    htmlBody,
      headers: {
        "List-Unsubscribe":      `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    pass("Email sent ✅", `messageId=${info.messageId} → to=${to}`);
  } catch (e) {
    fail("Email send FAILED", e.message);
    return sendHtml(res, steps, leadId, campId, pixelUrl, to);
  }

  // 5. Return result with monitoring instructions
  return sendHtml(res, steps, leadId, campId, pixelUrl, to);
};

function sendHtml(res, steps, leadId, campId, pixelUrl, to) {
  const allOk  = steps.every(s => s.ok);
  const checkUrl = `${process.env.APP_URL||"https://enginerdsmail.vercel.app"}/api/ops?type=events&leadId=${leadId}&campaignId=${campId}`;
  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><title>Send Test</title>
<style>
  body{font-family:monospace;max-width:760px;margin:40px auto;padding:0 20px;background:#0d0d0d;color:#e0e0e0}
  h1{font-size:18px}
  .step{display:flex;gap:12px;padding:8px 12px;border-radius:6px;margin-bottom:6px;font-size:13px}
  .ok{background:#0f2a0f;border:1px solid #1a5c1a}
  .fail{background:#2a0f0f;border:1px solid #5c1a1a}
  .name{font-weight:600}
  .detail{color:#999;font-size:11px;margin-top:2px;word-break:break-all}
  .box{background:#111;border:1px solid #333;padding:12px;border-radius:6px;margin-top:16px;font-size:12px;word-break:break-all}
  .sum{margin-top:20px;padding:16px;border-radius:8px;text-align:center;font-size:15px;font-weight:700}
  .ok-sum{background:#0f3a0f;border:2px solid #22c55e;color:#22c55e}
  .fail-sum{background:#3a0f0f;border:2px solid #ef4444;color:#ef4444}
  a{color:#888}
</style></head>
<body>
<h1>📬 Send Test → ${esc(to)}</h1>
${steps.map(s => `<div class="step ${s.ok?'ok':'fail'}">
  <span>${s.ok?'✅':'❌'}</span>
  <div><div class="name">${esc(s.name)}</div>${s.detail?`<div class="detail">${esc(s.detail)}</div>`:''}</div>
</div>`).join('')}
<div class="sum ${allOk?'ok-sum':'fail-sum'}">${allOk?'✅ Email sent — open it to trigger tracking':'❌ FAILED'}</div>
<div class="box">
  <b>Lead ID:</b> ${esc(leadId)}<br>
  <b>Campaign:</b> ${esc(campId)}<br>
  <b>Pixel URL:</b> <a href="${esc(pixelUrl)}" target="_blank">${esc(pixelUrl)}</a><br>
  <b>Check events:</b> <a href="${esc(checkUrl)}" target="_blank">${esc(checkUrl)}</a>
</div>
</body></html>`;
  res.setHeader("Content-Type","text/html");
  res.status(allOk?200:500).send(html);
}
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
