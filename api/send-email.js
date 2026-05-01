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
  // Build simpler tracking URL - use path-based routing instead of query params
  // This avoids quoted-printable encoding issues with = and & characters
  const trackingPath = campaignId 
    ? `/api/track/open/${leadId}/${campaignId}`
    : `/api/track/open/${leadId}`;
  const trackingPixelUrl = `${appUrl}${trackingPath}`;
  
  // Split into paragraphs on double newlines, single newlines become <br>
  const paragraphs = plainText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .split(/\n{2,}/)
    .map(para => {
      // Track URLs within each paragraph - use simpler format
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

  const trackingPixel = `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;border:0;">`;
  const unsubUrl = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&id=${leadId}`;

  console.log(`🔍 [EMAIL BUILD] Tracking pixel URL: ${trackingPixelUrl}`);
  console.log(`🔍 [EMAIL BUILD] Lead ID: ${leadId}, Campaign ID: ${campaignId}`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<title>Email from Enginerds</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#000000;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#ffffff;border-radius:8px;padding:32px 24px;">
      ${paragraphs}
    </div>
    
    <!-- Footer with unsubscribe -->
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.4;">
        This email was sent by Enginerds Tech Solution<br>
        <a href="${unsubUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
      </p>
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
