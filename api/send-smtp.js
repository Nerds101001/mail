// api/send-smtp.js — SMTP sender (MNC-grade, nodemailer)
const nodemailer = require("nodemailer");
const { get }    = require("./_redis");

// ─── HTML body builder (tracking intact) ─────────────────────────────────────
function buildHtmlBody(plainText, leadId, email, appUrl) {
  const htmlText = plainText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const trackedText = htmlText.replace(
    /https?:\/\/[^\s<"&]+/g,
    (url) => `<a href="${appUrl}/api/track/click?id=${leadId}&url=${encodeURIComponent(url)}" style="color:#1a73e8;">${url}</a>`
  );

  const trackingPixel = `<img src="${appUrl}/api/track/open?id=${leadId}" width="1" height="1" alt="" style="display:none;border:0;"/>`;
  const unsubUrl = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&id=${leadId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#333333;">
  <div style="max-width:600px;margin:0 auto;padding:24px 20px;">
    <div style="padding:0 0 24px 0;">${trackedText}</div>
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eeeeee;font-size:11px;color:#999999;line-height:1.8;">
      You're receiving this because we thought it might be relevant to you.<br>
      <a href="${unsubUrl}" style="color:#999999;text-decoration:underline;">Unsubscribe</a> from future emails.
    </div>
  </div>
  ${trackingPixel}
</body>
</html>`;
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
        "X-Mailer":                "Enginerds-Lead-Engine/2.0",
        "Precedence":              "bulk",
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
