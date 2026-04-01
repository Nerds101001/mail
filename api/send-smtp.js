const nodemailer = require('nodemailer');
const { get } = require('./_redis');

// ─── Build tracked "Real Mail" HTML body ─────────────────────────────────────
function buildHtmlBody(plainText, leadId, email, appUrl) {
  // 1. Basic text processing
  const htmlText = plainText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  // 2. Click tracking (minimal)
  const trackedText = htmlText.replace(
    /https?:\/\/[^\s<"]+/g,
    (url) => `<a href="${appUrl}/api/track/click?id=${leadId}&url=${encodeURIComponent(url)}">${url}</a>`
  );

  // 3. Open tracking pixel (invisible)
  const trackingPixel = `<img src="${appUrl}/api/track/open?id=${leadId}" width="1" height="1" style="display:none;"/>`;

  // 4. Subtle Unsubscribe link
  const unsubscribeLink = `<div style="margin-top:40px; padding-top:10px; border-top:1px solid #eee; font-size:11px; color:#999;">
    If you'd rather not receive these emails, you can <a href="${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&id=${leadId}" style="color:#999; text-decoration:underline;">unsubscribe</a>.
  </div>`;

  // 5. Clean, left-aligned structure
  return `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #333; margin: 0; padding: 20px; text-align: left;">
  <div style="max-width: 100%;">${trackedText}</div>
  ${unsubscribeLink}
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

  try {
    // 1. HARD CHECK: Check if the user is in the unsubscribe list
    const isUnsubscribed = await get(`unsub:${to}`);
    if (isUnsubscribed === "true") {
      console.log(`Skipping SMTP send to unsubscribed email: ${to}`);
      return res.status(200).json({ success: false, skipped: true, reason: "UNSUBSCRIBED" });
    }

    const { host, port, user, pass, secure } = smtpConfig;

    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: !!secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });

    const htmlBody = buildHtmlBody(body, leadId, to, appUrl);

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
