// api/gmail-auth.js
// Step 1 of OAuth: redirect user to Google's consent screen
// Env vars needed:
//   GOOGLE_CLIENT_ID
//   APP_URL  (e.g. https://your-app.vercel.app)

module.exports = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.APP_URL;

  if (!clientId || !appUrl) {
    return res.status(500).json({ error: "Missing GOOGLE_CLIENT_ID or APP_URL env vars" });
  }

  const redirectUri = `${appUrl}/api/gmail-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // Send + Read scopes for Gmail
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
    access_type: "offline",   // gets refresh_token so we don't need to re-auth
    prompt: "consent",        // always show consent to ensure refresh_token is returned
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  res.redirect(googleAuthUrl);
};
