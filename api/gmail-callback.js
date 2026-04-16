// api/gmail-callback.js
// Step 2 of OAuth: Google redirects here with ?code=...
// We exchange the code for access + refresh tokens and store them in Redis
// Env vars needed:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   APP_URL

const { set } = require("./_redis");

module.exports = async (req, res) => {
  const { code, error } = req.query;
  let appUrl = (process.env.APP_URL || '').replace(/^["']|["']$/g, '').trim();
  if (appUrl && !appUrl.startsWith('http')) appUrl = 'https://' + appUrl;

  // If user denied access
  if (error) {
    return res.redirect(`${appUrl}/?gmail=denied`);
  }

  if (!code) {
    return res.status(400).json({ error: "No code received from Google" });
  }

  const redirectUri = `${appUrl}/api/gmail-callback`;

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      console.error("Token exchange error:", tokens);
      return res.redirect(`${appUrl}/?gmail=error&msg=${encodeURIComponent(tokens.error_description)}`);
    }

    // Get Gmail account info so we can show which account is connected
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    // Store tokens in Redis (no expiry — refresh_token is permanent until revoked)
    await set("gmail:access_token", tokens.access_token);
    await set("gmail:refresh_token", tokens.refresh_token);
    await set("gmail:email", profile.email);
    await set("gmail:expires_at", Date.now() + tokens.expires_in * 1000);

    // Redirect back to the app with success flag
    res.redirect(`${appUrl}/?gmail=connected&account=${encodeURIComponent(profile.email)}`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`${appUrl}/?gmail=error&msg=${encodeURIComponent(err.message)}`);
  }
};
