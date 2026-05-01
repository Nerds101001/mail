// api/send-email.js — Gmail OAuth sender (MNC-grade)
const { get, set } = require("./_redis");

// ─── Token refresh with better error handling ────────────────────────────────────
async function getValidAccessToken(accountEmail = null) {
  // Support per-account keys for multi-Gmail setup
  const suffix = accountEmail ? `:${accountEmail.replace(/[^a-z0-9]/gi, '_')}` : '';
  const expiresAt = parseInt(await get(`gmail:expires_at${suffix}`) || "0");
  let accessToken = await get(`gmail:access_token${suffix}`);

  if (Date.now() > expiresAt - 60000) { // Refresh 1 minute before expiry
    const refreshToken = await get(`gmail:refresh_token${suffix}`);
    if (!refreshToken) {
      throw new Error("Gmail connection expired - please reconnect in Settings");
    }

    console.log(`🔄 [GMAIL TOKEN] Refreshing token for ${accountEmail || 'default account'}`);
    
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type:    "refresh_token",
        }),
      });
      
      const data = await res.json();
      
      if (data.error) {
        console.error(`❌ [GMAIL TOKEN] Refresh failed: ${data.error_description}`);
        
        // If refresh token is invalid, clear all tokens to force re-auth
        if (data.error === 'invalid_grant') {
          await Promise.all([
            set(`gmail:access_token${suffix}`, ''),
            set(`gmail:refresh_token${suffix}`, ''),
            set(`gmail:expires_at${suffix}`, '0')
          ]);
          throw new Error("Gmail authorization expired - please reconnect in Settings");
        }
        
        throw new Error(`Token refresh failed: ${data.error_description}`);
      }
      
      accessToken = data.access_token;
      const newExpiresAt = Date.now() + (data.expires_in * 1000);
      
      await Promise.all([
        set(`gmail:access_token${suffix}`, accessToken),
        set(`gmail:expires_at${suffix}`, String(newExpiresAt))
      ]);
      
      console.log(`✅ [GMAIL TOKEN] Token refreshed successfully for ${accountEmail || 'default account'}`);
      
    } catch (fetchError) {
      console.error(`❌ [GMAIL TOKEN] Network error during refresh:`, fetchError.message);
      throw new Error("Failed to refresh Gmail token - check internet connection");
    }
  }
  
  return accessToken;
}

// ─── RFC 2822 builder with proper MIME multipart structure ─────────────────
function buildEmailRaw({ from, replyTo, to, subject, htmlBody, unsubscribeUrl }) {
  const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@enginerds.in>`;
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  // Extract plain text from HTML for text/plain version
  const plainText = htmlBody
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
  
  // Use 8bit encoding with proper line wrapping to prevent quoted-printable
  // Wrap HTML at safe points (after >) to keep lines under 998 chars (RFC 5322 limit)
  const htmlLines = [];
  let currentLine = '';
  
  for (let i = 0; i < htmlBody.length; i++) {
    currentLine += htmlBody[i];
    
    // Break after > if line is getting long (keep under 900 chars for safety)
    if (currentLine.length >= 900 && htmlBody[i] === '>') {
      htmlLines.push(currentLine);
      currentLine = '';
    }
  }
  if (currentLine) htmlLines.push(currentLine);
  
  const wrappedHtml = htmlLines.join('\r\n');
  
  const lines = [
    `From: ${from}`,
    `Reply-To: ${replyTo}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `List-Unsubscribe: <${unsubscribeUrl}>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    plainText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    wrappedHtml,
    ``,
    `--${boundary}--`
  ].join("\r\n");

  // Gmail API requires the entire message to be base64url encoded
  return Buffer.from(lines, 'utf-8').toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── HTML body builder (improved deliverability) ─────────────────────────────────
function buildHtmlBody(plainText, leadId, email, appUrl, campaignId = null) {
  // Query-param tracking URLs — reliable across all Vercel rewrite configs.
  // Path-based URLs (/api/track/open/id/cid) lost the path after Vercel rewrite;
  // query params are passed through intact.
  const pixelParams = campaignId
    ? `id=${leadId}&cid=${campaignId}`
    : `id=${leadId}`;
  const trackingPixelUrl = `${appUrl}/api/track-open?${pixelParams}`;

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

  const trackingPixel = `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;border:0;">`;
  const unsubUrl = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&id=${leadId}`;

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

  const { leadId, to, subject, body, senderName, replyTo, gmailUser, campaignId } = req.body;
  const appUrl = process.env.APP_URL;

  if (!leadId || !to || !subject || !body)
    return res.status(400).json({ error: "Missing required fields: leadId, to, subject, body" });

  try {
    const isUnsub = await get(`unsub:${to}`);
    if (isUnsub === "true")
      return res.status(200).json({ success: false, skipped: true, reason: "UNSUBSCRIBED" });

    // Use per-account token if gmailUser specified (multi-Gmail round-robin)
    const accessToken  = await getValidAccessToken(gmailUser || null);
    const gmailAccount = gmailUser || await get("gmail:email");
    if (!gmailAccount) throw new Error("Gmail not connected — please reconnect in Settings");
    const from       = `${senderName || "Enginerds Tech"} <${gmailAccount}>`;
    const unsubUrl   = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(to)}&id=${leadId}`;
    const htmlBody   = buildHtmlBody(body, leadId, to, appUrl, campaignId);
    const raw        = buildEmailRaw({ from, replyTo: replyTo || gmailAccount, to, subject, htmlBody, unsubscribeUrl: unsubUrl });

    // Write scanner-guard BEFORE sending — Gmail delivers nearly instantly after
    // the API call returns, and the Image Proxy fires within milliseconds of
    // delivery. Writing AFTER send creates a race where the proxy hits the pixel
    // before the guard key exists in DB, causing every send to show 1 false open.
    await set(`email:guard:${leadId}`, String(Date.now()), 30).catch(() => {});

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });

    const result = await sendRes.json();
    if (result.error) throw new Error(result.error.message || "Gmail send failed");

    res.json({ success: true, messageId: result.id });
  } catch (err) {
    console.error("send-email error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
