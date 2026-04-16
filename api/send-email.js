// api/send-email.js — Gmail OAuth sender (MNC-grade)
const { get, set } = require("./_redis");

// ─── Token refresh ────────────────────────────────────────────────────────────
async function getValidAccessToken() {
  const expiresAt = parseInt(await get("gmail:expires_at") || "0");
  let accessToken = await get("gmail:access_token");

  if (Date.now() > expiresAt - 60000) {
    const refreshToken = await get("gmail:refresh_token");
    if (!refreshToken) throw new Error("No refresh token — please reconnect Gmail in Settings");

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
    if (data.error) throw new Error(`Token refresh failed: ${data.error_description}`);
    accessToken = data.access_token;
    await set("gmail:access_token", accessToken);
    await set("gmail:expires_at", String(Date.now() + data.expires_in * 1000));
  }
  return accessToken;
}

// ─── RFC 2822 builder ─────────────────────────────────────────────────────────
function buildEmailRaw({ from, replyTo, to, subject, htmlBody, unsubscribeUrl }) {
  const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@enginerds.in>`;
  const lines = [
    `From: ${from}`,
    `Reply-To: ${replyTo}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    `X-Mailer: Enginerds-Lead-Engine/2.0`,
    `Precedence: bulk`,
    `List-Unsubscribe: <${unsubscribeUrl}>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    ``,
    htmlBody,
  ].join("\r\n");

  return Buffer.from(lines).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

  const { leadId, to, subject, body, senderName, replyTo } = req.body;
  const appUrl = process.env.APP_URL;

  if (!leadId || !to || !subject || !body)
    return res.status(400).json({ error: "Missing required fields: leadId, to, subject, body" });

  try {
    // Hard unsubscribe check
    const isUnsub = await get(`unsub:${to}`);
    if (isUnsub === "true")
      return res.status(200).json({ success: false, skipped: true, reason: "UNSUBSCRIBED" });

    const accessToken  = await getValidAccessToken();
    const gmailAccount = await get("gmail:email");
    if (!gmailAccount) throw new Error("Gmail not connected — please reconnect in Settings");

    const from       = `${senderName || "Enginerds Tech"} <${gmailAccount}>`;
    const unsubUrl   = `${appUrl}/api/unsubscribe?email=${encodeURIComponent(to)}&id=${leadId}`;
    const htmlBody   = buildHtmlBody(body, leadId, to, appUrl);
    const raw        = buildEmailRaw({ from, replyTo: replyTo || gmailAccount, to, subject, htmlBody, unsubscribeUrl: unsubUrl });

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
