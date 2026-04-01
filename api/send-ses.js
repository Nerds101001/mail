const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

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

  const unsubscribeUrl = `${appUrl}/unsubscribe.html?id=${leadId}`;
  const unsubscribeFooter = `
    <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
      You are receiving this because you're a valued lead. <br>
      <a href="${unsubscribeUrl}" style="color:#666;text-decoration:underline;">Unsubscribe</a> or Manage preferences
    </div>
  `;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
  <div>${trackedText}</div>
  ${unsubscribeFooter}
  ${trackingPixel}
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { leadId, to, subject, body, senderName, replyTo, sesConfig } = req.body;
  const appUrl = process.env.APP_URL || "https://" + req.headers.host;

  if (!leadId || !to || !subject || !body || !sesConfig) {
    return res.status(400).json({ error: "Missing required fields: leadId, to, subject, body, sesConfig" });
  }

  const { region, accessKeyId, secretAccessKey, senderEmail } = sesConfig;

  try {
    const client = new SESClient({
      region: region || "us-east-1",
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });

    const htmlBody = buildHtmlBody(body, leadId, appUrl);
    const unsubscribeUrl = `${appUrl}/unsubscribe.html?id=${leadId}`;

    const command = new SendEmailCommand({
      Destination: { ToAddresses: [to] },
      Message: {
        Body: {
          Html: { Data: htmlBody, Charset: "UTF-8" },
          Text: { Data: body + `\n\nUnsubscribe: ${unsubscribeUrl}`, Charset: "UTF-8" }
        },
        Subject: { Data: subject, Charset: "UTF-8" }
      },
      Source: `"${senderName}" <${senderEmail}>`,
      ReplyToAddresses: [replyTo || senderEmail]
    });

    const response = await client.send(command);
    res.json({ success: true, messageId: response.MessageId });
  } catch (err) {
    console.error("SES Send error:", err);
    res.status(500).json({ error: err.message });
  }
};
