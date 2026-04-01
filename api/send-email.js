const { get, set } = require("./_redis");

// ─── Refresh access token if expired ─────────────────────────────────────────
async function getValidAccessToken() {
  const expiresAt = parseInt(await get("gmail:expires_at") || "0");
  let accessToken = await get("gmail:access_token");

  if (Date.now() > expiresAt - 60000) {
    const refreshToken = await get("gmail:refresh_token");
    if (!refreshToken) throw new Error("No refresh token — please reconnect Gmail");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(`Token refresh failed: ${data.error_description}`);

    accessToken = data.access_token;
    await set("gmail:access_token", accessToken);
    await set("gmail:expires_at", Date.now() + data.expires_in * 1000);
  }

  return accessToken;
}

// ─── Build RFC 2822 email ────────────────────────────────────────────────────
function buildEmailRaw({ from, replyTo, to, subject, htmlBody }) {
  const message = [
    `From: ${from}`,
    `Reply-To: ${replyTo}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    htmlBody,
  ].join("\r\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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

  // 4. Subtle Unsubscribe link (standard in real emails)
  const unsubscribeLink = `<div style="margin-top:40px; padding-top:10px; border-top:1px solid #eee; font-size:11px; color:#999;">
    If you'd rather not receive these emails, you can <a href="${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&id=${leadId}" style="color:#999; text-decoration:underline;">unsubscribe</a>.
  </div>`;

  // 5. Clean, left-aligned, non-templated structure
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

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { leadId, to, subject, body, senderName, replyTo } = req.body;
  const appUrl = process.env.APP_URL;

  if (!leadId || !to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields: leadId, to, subject, body" });
  }

  try {
    // 1. HARD CHECK: Check if the user is in the unsubscribe list
    const isUnsubscribed = await get(`unsub:${to}`);
    if (isUnsubscribed === "true") {
      console.log(`Skipping send to unsubscribed email: ${to}`);
      return res.status(200).json({ success: false, skipped: true, reason: "UNSUBSCRIBED" });
    }

    const accessToken = await getValidAccessToken();
    const gmailAccount = await get("gmail:email");

    const from = `${senderName || "Enginerds Tech"} <${gmailAccount}>`;
    const htmlBody = buildHtmlBody(body, leadId, to, appUrl);
    const raw = buildEmailRaw({ from, replyTo: replyTo || gmailAccount, to, subject, htmlBody });

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    const result = await sendRes.json();
    if (result.error) throw new Error(result.error.message || "Gmail send failed");

    res.json({ success: true, messageId: result.id });
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).json({ error: err.message });
  }
};
