// api/send-smtp.js
// Sends email via standard SMTP using nodemailer
// Supports tracking pixel and click redirects

const nodemailer = require('nodemailer');

// ─── Build tracked HTML body ──────────────────────────────────────────────
function buildHtmlBody(plainText, leadId, appUrl) {
  const htmlText = plainText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const trackingPixel = `<img src="${appUrl}/api/track/open?id=${leadId}" width="1" height="1" style="display:none;visibility:hidden;" alt=""/>`;

  const trackedText = htmlText.replace(
    /https?:\/\/[^\s<"]+/g,
    (url) => `<a href="${appUrl}/api/track/click?id=${leadId}&url=${encodeURIComponent(url)}">${url}</a>`
  );

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
  <div>${trackedText}</div>
  ${trackingPixel}
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { leadId, to, subject, body, senderName, replyTo, smtpConfig } = req.body;
  const appUrl = process.env.APP_URL;

  if (!leadId || !to || !subject || !body || !smtpConfig) {
    return res.status(400).json({ error: "Missing required fields: leadId, to, subject, body, smtpConfig" });
  }

  const { host, port, user, pass, secure } = smtpConfig;

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: !!secure, // true for 465, false for other ports
      auth: { user, pass },
    });

    const htmlBody = buildHtmlBody(body, leadId, appUrl);

    const info = await transporter.sendMail({
      from: `"${senderName}" <${user}>`,
      to,
      subject,
      replyTo: replyTo || user,
      html: htmlBody,
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error("SMTP Send error:", err);
    res.status(500).json({ error: err.message });
  }
};
