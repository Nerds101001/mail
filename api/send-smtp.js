// api/send-smtp.js — SMTP sender (MNC-grade, nodemailer)
const nodemailer = require("nodemailer");
const { get }    = require("./_redis");

// ─── HTML body builder (tracking intact) ─────────────────────────────────────
function buildHtmlBody(plainText, leadId, email, appUrl) {
  const paragraphs = plainText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .split(/\n{2,}/)
    .map(para => {
      const tracked = para.replace(/\n/g, "<br>").replace(
        /https?:\/\/[^\s<"&]+/g,
        (url) => `<a href="${appUrl}/api/track/click?id=${leadId}&url=${encodeURIComponent(url)}" style="color:#1a73e8;">${url}</a>`
      )
      return `<p style="margin:0 0 16px 0;line-height:1.7;">${tracked}</p>`
    })
    .join('')

  const trackingPixel = `<img src="${appUrl}/api/track/open?id=${leadId}" width="1" height="1" alt="" style="display:none;border:0;"/>`
  const unsubUrl = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&id=${leadId}`

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;">
  <div style="padding:24px 20px;max-width:600px;">
    <div>${paragraphs}</div>
    <div style="margin-top:48px;font-size:11px;color:#cccccc;">
      <a href="${unsubUrl}" style="color:#cccccc;text-decoration:none;">unsubscribe</a>
    </div>
  </div>
  ${trackingPixel}
</body>
</html>`
}

// ─── Handler ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { leadId, to, subject, body, senderName, replyTo, smtpConfig } = req.body;
  const appUrl = process.env.APP_URL;

  if (!leadId || !to || !subject || !body || !smtpConfig)
    return res.status(400).json({ error: "Missing required fields: leadId, to, subject, body, smtpConfig" });

  try {
    // Hard unsubscribe check
    const isUnsub = await get(`unsub:${to}`);
    if (isUnsub === "true")
      return res.status(200).json({ success: false, skipped: true, reason: "UNSUBSCRIBED" });

    const { host, port, user, pass, secure } = smtpConfig;
    const unsubUrl = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(to)}&id=${leadId}`;
    const msgId    = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${host}>`;

    const transporter = nodemailer.createTransport({
      host,
      port:    parseInt(port),
      secure:  !!secure,
      auth:    { user, pass },
      tls:     { rejectUnauthorized: false }, // allow self-signed certs on custom SMTP
      pool:    false,
      connectionTimeout: 10000,
      greetingTimeout:   10000,
    });

    const htmlBody = buildHtmlBody(body, leadId, to, appUrl);

    const info = await transporter.sendMail({
      from:    `"${senderName}" <${user}>`,
      to,
      subject,
      replyTo: replyTo || user,
      html:    htmlBody,
      headers: {
        "Message-ID":              msgId,
        "List-Unsubscribe":        `<${unsubUrl}>`,
        "List-Unsubscribe-Post":   "List-Unsubscribe=One-Click",
      },
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error("send-smtp error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
