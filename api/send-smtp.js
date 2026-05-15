// api/send-smtp.js — SMTP sender (MNC-grade, nodemailer)
const nodemailer = require("nodemailer");
const { get, set } = require("./_redis");

// ─── Fetch real file data from Postgres for MIME attachments ────────────────
async function fetchAttachmentData(attachments) {
  if (!attachments || !attachments.length) return [];
  try {
    const { neon } = require("@neondatabase/serverless");
    const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
    const ids = attachments.map(a => a.id);
    const rows = await sql`SELECT id, original_name, content_type, data FROM attachments WHERE id = ANY(${ids})`;
    return rows;
  } catch (e) {
    console.error("❌ [SMTP] Failed to fetch attachment data:", e.message);
    return [];
  }
}

// ─── HTML body builder ────────────────────────────────────────────────────────
// Files are now sent as real MIME attachments — no link section in the body.
function buildHtmlBody(plainText, leadId, email, appUrl, campaignId = null) {
  // Query-param tracking URLs — reliable across all Vercel rewrite configs.
  const pixelParams = campaignId
    ? `id=${leadId}&cid=${campaignId}`
    : `id=${leadId}`;

  const paragraphs = plainText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .split(/\n{2,}/)
    .map(para => {
      const tracked = para.replace(/\n/g, "<br>").replace(
        /https?:\/\/[^\s<"&]+/g,
        (url) => {
          const clickParams = campaignId
            ? `id=${leadId}&cid=${campaignId}&url=${encodeURIComponent(url)}`
            : `id=${leadId}&url=${encodeURIComponent(url)}`;
          return `<a href="${appUrl}/api/track-click?${clickParams}" style="color:#1a73e8;text-decoration:none;">${url}</a>`;
        }
      )
      return `<p style="margin:0 0 14px 0;">${tracked}</p>`
    })
    .join('')

  const trackingPixel = `<img src="${appUrl}/api/track-open?${pixelParams}" width="1" height="1" alt="" style="display:none;border:0;"/>`
  const unsubUrl = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&id=${leadId}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#000000;background:#ffffff;">
  <div style="padding:12px 16px;">
    ${paragraphs}
    <p style="margin:24px 0 0 0;font-size:11px;color:#aaaaaa;">
      <a href="${unsubUrl}" style="color:#aaaaaa;text-decoration:underline;">Unsubscribe</a>
    </p>
  </div>
  ${trackingPixel}
</body>
</html>`
}

// ─── Handler ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { leadId, to, subject, body, senderName, replyTo, smtpConfig, campaignId, attachments } = req.body;
  const appUrl = process.env.APP_URL || "https://enginerdsmail.vercel.app";

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
      // Vercel Hobby functions time out at 10 s — keep all SMTP phases well under that.
      connectionTimeout: 4000,  // TCP connect
      greetingTimeout:   3000,  // server banner after connect
      socketTimeout:     8000,  // any idle period during send
    });

    const htmlBody       = buildHtmlBody(body, leadId, to, appUrl, campaignId || null);
    const attachmentData = await fetchAttachmentData(attachments || []);

    // Write scanner-guard BEFORE sending.
    // With attachments the mail scanner downloads the file before firing the pixel
    // — takes 10-30s, bypassing the normal 5s window. Shift the guard timestamp
    // 30s forward so _redis.js treats the first ~35s as "within 5s" and blocks it.
    const hasAttachments = attachmentData.length > 0;
    const guardValue = hasAttachments ? String(Date.now() + 30000) : String(Date.now());
    const guardTtl   = hasAttachments ? 90 : 30;
    await set(`email:guard:${leadId}`, guardValue, guardTtl).catch(() => {});

    const info = await transporter.sendMail({
      from:    `"${senderName}" <${user}>`,
      to,
      subject,
      replyTo: replyTo || user,
      // Force 8bit encoding so nodemailer doesn't apply quoted-printable.
      // Quoted-printable encodes = as =3D and line-wraps URLs at 76 chars,
      // which corrupts tracking pixel and click URLs in the email source.
      encoding: '8bit',
      html:    htmlBody,
      headers: {
        "Message-ID":              msgId,
        "List-Unsubscribe":        `<${unsubUrl}>`,
        "List-Unsubscribe-Post":   "List-Unsubscribe=One-Click",
      },
      // Real file attachments — shown as native attachment in email clients
      attachments: attachmentData.map(att => ({
        filename:    att.original_name,
        content:     Buffer.from(att.data, 'base64'),
        contentType: att.content_type,
      })),
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error("send-smtp error:", err.message);

    const msg  = err.message || ''
    const code = err.responseCode || 0

    // Daily / rate-limit errors — sender quota exhausted for today
    // Common codes: 452 (too many messages), 421 (service temporarily unavailable)
    // Hostinger returns 452 with "Daily sending quota exceeded" or similar wording
    const isRateLimit =
      code === 452 || code === 421 ||
      /daily|quota|limit.*exceed|too many.*message|sending limit|rate.*limit|blocked.*sending/i.test(msg)
    if (isRateLimit) return res.json({ success: false, rateLimited: true, reason: msg })

    // Hard bounces — permanent delivery failure
    const isBounce = code >= 550 || err.code === 'EENVELOPE' ||
                     /does not exist|no such user|user unknown|invalid address/i.test(msg)
    if (isBounce) return res.json({ success: false, bounced: true, reason: msg })

    // Timeout — likely Vercel's 10s limit; treat as transient failure (not a bounce)
    const isTimeout = err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' ||
                      /timeout|ECONNREFUSED|ECONNRESET/i.test(msg)
    if (isTimeout) {
      console.error("send-smtp: timeout — SMTP took too long for Vercel Hobby (10s limit)")
      return res.status(504).json({ error: "SMTP timeout — connection too slow", timeout: true })
    }

    res.status(500).json({ error: msg })
  }
};
