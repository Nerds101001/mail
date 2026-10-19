// api/send-smtp.js — SMTP sender (MNC-grade, nodemailer)
const nodemailer = require("nodemailer");
const { get, set } = require("./_redis");
const { pickSignature, resolveSignatureUser, placeSignature, signatureBlock, stripAttachmentIcon } = require("./_signature");
const { classifySmtpError } = require("./_sendErrors");

// ─── Fetch real file data from Postgres for MIME attachments ────────────────
async function fetchAttachmentData(attachments) {
  if (!attachments || !attachments.length) return [];
  try {
    const { getSql } = require("./_db");
    const sql = getSql();
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
// signatureHtml = the signature uploaded in Settings (optional, see _signature.js):
// replaces the name lines under the closing word, or goes after the last paragraph.
function buildHtmlBody(plainText, leadId, email, appUrl, campaignId = null, interestHtml = '', signatureHtml = '') {
  // Query-param tracking URLs — reliable across all Vercel rewrite configs.
  const pixelParams = campaignId
    ? `id=${leadId}&cid=${campaignId}`
    : `id=${leadId}`;

  const sigBlock = signatureBlock(signatureHtml);
  const { paras: rawParas, sigAfter, closerIdx } = placeSignature(stripAttachmentIcon(plainText).split(/\n{2,}/), signatureHtml);
  // Quick Response buttons sit ABOVE the signature (above "Best," when the body has a sign-off).
  // With no signature they stay at the very end, as before.
  const buttonsAbove = !!(signatureHtml && interestHtml);

  const paragraphs = rawParas
    .map(p => p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .map((para, idx) => {
      // Wrap links through /api/track-click. Matches full http(s) URLs AND bare
      // "www.example.com" domains — Gmail auto-links those, so an unwrapped one
      // sends the click straight to the destination and we never see it.
      // Text is already HTML-escaped here ('&' is '&amp;'): recover the real URL
      // for the redirect target, and keep trailing punctuation out of the link.
      const tracked = para.replace(/\n/g, "<br>").replace(
        /(https?:\/\/[^\s<"]+|(?<![\w@.\/-])www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<"]*)?)/gi,
        (m) => {
          const trail = (m.match(/[.,;:!?)\]]+$/) || [''])[0];
          const shown = trail ? m.slice(0, -trail.length) : m;
          const real  = shown.replace(/&amp;/g, '&');
          const dest  = /^https?:\/\//i.test(real) ? real : `https://${real}`;
          const clickParams = campaignId
            ? `id=${leadId}&cid=${campaignId}&url=${encodeURIComponent(dest)}`
            : `id=${leadId}&url=${encodeURIComponent(dest)}`;
          return `<a href="${appUrl}/api/track-click?${clickParams}" style="color:#1a73e8;text-decoration:none;">${shown}</a>${trail}`;
        }
      )
      // Closing line sits tight against the signature (like a normal compose window)
      const gap = idx === sigAfter && sigBlock ? '0 0 2px 0' : '0 0 14px 0';
      let html = '';
      if (buttonsAbove && closerIdx >= 0 && idx === closerIdx) html += interestHtml;       // above "Best,"
      html += `<p style="margin:${gap};">${tracked}</p>`;
      if (idx === sigAfter) {
        if (buttonsAbove && closerIdx < 0) html += interestHtml;                           // no sign-off: right above the signature
        html += sigBlock;
      }
      return html;
    })
    .join('')

  const trackingPixel = `<img src="${appUrl}/api/track-open?${pixelParams}" width="1" height="1" alt="" style="display:none;border:0;"/>`

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
    ${buttonsAbove ? '' : interestHtml}
  </div>
  ${trackingPixel}
</body>
</html>`
}

// ─── Handler ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { leadId, to, subject, body, senderName, replyTo, smtpConfig, campaignId, attachments, interestHtml } = req.body;
  const appUrl = process.env.APP_URL || "https://enginerdsmail.vercel.app";

  if (!leadId || !to || !subject || !body || !smtpConfig)
    return res.status(400).json({ error: "Missing required fields: leadId, to, subject, body, smtpConfig" });

  try {
    // Hard unsubscribe check
    const isUnsub = await get(`unsub:${to}`);
    if (isUnsub === "true")
      return res.status(200).json({ success: false, skipped: true, reason: "UNSUBSCRIBED" });

    const { host, port, user, pass, secure } = smtpConfig;
    const msgId    =`<${Date.now()}.${Math.random().toString(36).slice(2)}@${host}>`;

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

    // Uploaded signature of whoever owns this send (SMTP has no Gmail identity to read one from).
    const sigUserId      = await resolveSignatureUser({ campaignId, authorization: req.headers.authorization, userId: req.body.userId });
    const signatureHtml  = await pickSignature({ userId: sigUserId });
    const htmlBody       = buildHtmlBody(body, leadId, to, appUrl, campaignId || null, interestHtml || '', signatureHtml);
    const attachmentData = await fetchAttachmentData(attachments || []);

    // 10-second guard: store send timestamp before handing off to SMTP.
    // trackOpen() in _redis.js rejects any pixel hit within 10s of this value.
    const fhKey = `email:first-hit:${leadId}:${campaignId || 'direct'}`;
    await set(fhKey, String(Date.now()), 7 * 24 * 3600).catch(() => {});

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

    // Why it failed (see _sendErrors.js): a bad login → skip this account; couldn't connect or a
    // 4xx refusal → safe to retry tomorrow; a timeout/reset mid-send → outcome unknown, never retried.
    const kind = classifySmtpError(err)

    // Timeout / connection trouble — not a bounce
    const isTimeout = err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' ||
                      /timeout|ECONNREFUSED|ECONNRESET/i.test(msg)
    if (isTimeout) {
      console.error(`send-smtp: connection problem (${kind}) — ${msg}`)
      return res.status(504).json({ error: "SMTP timeout — connection too slow", reason: msg, timeout: true, kind })
    }

    res.status(500).json({ error: msg, reason: msg, kind })
  }
};

// Exposed for tests (the default export stays the request handler).
module.exports.buildHtmlBody = buildHtmlBody;
