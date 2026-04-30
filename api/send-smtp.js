// api/send-smtp.js — SMTP sender (MNC-grade, nodemailer)
const nodemailer = require("nodemailer");
const { get }    = require("./_redis");

// ─── HTML body builder ────────────────────────────────────────────────────────
function buildHtmlBody(plainText, leadId, email, appUrl, campaignId = null) {
  const trackingPath = campaignId
    ? `/api/track/open/${leadId}/${campaignId}`
    : `/api/track/open/${leadId}`;

  const paragraphs = plainText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .split(/\n{2,}/)
    .map(para => {
      const tracked = para.replace(/\n/g, "<br>").replace(
        /https?:\/\/[^\s<"&]+/g,
        (url) => {
          const clickPath = campaignId
            ? `/api/track/click/${leadId}/${campaignId}/${encodeURIComponent(url)}`
            : `/api/track/click/${leadId}/${encodeURIComponent(url)}`;
          return `<a href="${appUrl}${clickPath}" style="color:#1a73e8;text-decoration:none;">${url}</a>`;
        }
      )
      return `<p style="margin:0 0 16px 0;line-height:1.6;color:#1a1a1a;">${tracked}</p>`
    })
    .join('')

  const trackingPixel = `<img src="${appUrl}${trackingPath}" width="1" height="1" alt="" style="display:none;border:0;"/>`
  const unsubUrl = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&id=${leadId}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="background:#ffffff;">
      ${paragraphs}
    </div>
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;">
      <a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
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

  const { leadId, to, subject, body, senderName, replyTo, smtpConfig, campaignId } = req.body;
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

    const htmlBody = buildHtmlBody(body, leadId, to, appUrl, campaignId || null);

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
    // Detect hard bounces (permanent delivery failures)
    const isBounce = (err.responseCode >= 550) || err.code === 'EENVELOPE' ||
                     /does not exist|no such user|user unknown|invalid address/i.test(err.message);
    if (isBounce) return res.json({ success: false, bounced: true, reason: err.message });
    res.status(500).json({ error: err.message });
  }
};
