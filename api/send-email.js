// api/send-email.js
// Sends an email via Gmail API using stored OAuth tokens
// Automatically embeds open-tracking pixel + wraps links for click tracking
//
// POST body:
//   { leadId, to, name, subject, body, senderName, replyTo }
//
// Env vars needed:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   APP_URL

const { get, set } = require("./_redis");

// ─── Refresh access token if expired ─────────────────────────────────────────
async function getValidAccessToken() {
  const expiresAt = parseInt(await get("gmail:expires_at") || "0");
  let accessToken = await get("gmail:access_token");

  // Refresh if within 60 seconds of expiry
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

// ─── Build RFC 2822 email with tracking ──────────────────────────────────────
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

  // Base64url encode (Gmail API requirement)
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Wrap plain text body into tracked HTML email ────────────────────────────
function buildHtmlBody(plainText, leadId, appUrl) {
  // Convert newlines to <br> for HTML
  const htmlText = plainText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  // Tracking pixel — 1x1 invisible image, loads when email is opened
  const trackingPixel = `<img src="${appUrl}/api/track/open?id=${leadId}" width="1" height="1" style="display:none;visibility:hidden;" alt=""/>`;

  // Wrap website links for click tracking
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
    const accessToken = await getValidAccessToken();
    const gmailAccount = await get("gmail:email");

    const from = `${senderName || "Enginerds Tech"} <${gmailAccount}>`;
    const htmlBody = buildHtmlBody(body, leadId, appUrl);
    const raw = buildEmailRaw({ from, replyTo: replyTo || gmailAccount, to, subject, htmlBody });

    // Send via Gmail API
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    const result = await sendRes.json();

    if (result.error) {
      throw new Error(result.error.message || "Gmail send failed");
    }

    res.json({ success: true, messageId: result.id });
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).json({ error: err.message });
  }
};
