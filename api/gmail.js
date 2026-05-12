// api/gmail.js — Combined Gmail OAuth handler
// GET  /api/gmail?type=auth     → Step 1: redirect to Google OAuth
// GET  /api/gmail?type=callback → Step 2: handle OAuth callback
// GET  /api/gmail?type=status   → Check Gmail connection status

const { get, set } = require("./_redis");

module.exports = async (req, res) => {
  const { type, code, state } = req.query;

  // ── STEP 1: REDIRECT TO GOOGLE OAUTH ──────────────────────────────────
  if (type === "auth") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    let appUrl = (process.env.APP_URL || '').replace(/^["']|["']$/g, '').trim();
    if (appUrl && !appUrl.startsWith('http')) appUrl = 'https://' + appUrl;

    if (!clientId || !appUrl) {
      return res.status(500).json({ error: "Missing GOOGLE_CLIENT_ID or APP_URL env vars" });
    }

    const redirectUri = `${appUrl}/api/gmail?type=callback`;
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email",
      ].join(" "),
      access_type: "offline",
      prompt: "consent",
    });

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    return res.redirect(googleAuthUrl);
  }

  // ── STEP 2: HANDLE OAUTH CALLBACK ─────────────────────────────────────
  if (type === "callback") {
    let appUrl = (process.env.APP_URL || '').replace(/^["']|["']$/g, '').trim();
    if (appUrl && !appUrl.startsWith('http')) appUrl = 'https://' + appUrl;
    const redirectUri = `${appUrl}/api/gmail?type=callback`;

    if (!code) {
      return res.redirect(`${appUrl}/?gmail=error&msg=${encodeURIComponent("Authorization code missing")}`);
    }

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
      if (tokens.error) throw new Error(tokens.error_description || tokens.error);

      // Get Gmail account info
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileRes.json();

      // Store tokens (support multi-account)
      const suffix = profile.email ? `:${profile.email.replace(/[^a-z0-9]/gi, '_')}` : '';
      await Promise.all([
        set(`gmail:access_token${suffix}`, tokens.access_token),
        set(`gmail:refresh_token${suffix}`, tokens.refresh_token),
        set(`gmail:expires_at${suffix}`, String(Date.now() + tokens.expires_in * 1000)),
        set("gmail:email", profile.email),
      ]);

      // ── Add Gmail account to crm:profiles so it shows in Campaign sender list ──
      try {
        const profilesRaw = await get('crm:profiles');
        const crmProfiles = profilesRaw ? JSON.parse(profilesRaw) : [];
        const existingIdx = crmProfiles.findIndex(p => p.type === 'gmail' && p.user === profile.email);
        const gmailProfile = {
          id:       existingIdx >= 0 ? crmProfiles[existingIdx].id : `gmail_${Date.now()}`,
          type:     'gmail',
          name:     profile.name || profile.email,
          user:     profile.email,
          email:    profile.email,
          active:   true,
          dailyCap: 500,
        };
        if (existingIdx >= 0) crmProfiles[existingIdx] = gmailProfile;
        else crmProfiles.push(gmailProfile);
        await set('crm:profiles', JSON.stringify(crmProfiles));
      } catch(profileErr) {
        console.warn('⚠ Could not update crm:profiles with Gmail account:', profileErr.message);
      }

      console.log(`✅ Gmail connected: ${profile.email}`);
      res.redirect(`${appUrl}/?gmail=connected&account=${encodeURIComponent(profile.email)}`);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.redirect(`${appUrl}/?gmail=error&msg=${encodeURIComponent(err.message)}`);
    }
    return;
  }

  // ── GMAIL STATUS (returns all connected accounts) ─────────────────────
  if (type === "status") {
    try {
      const profilesRaw = await get('crm:profiles');
      const crmProfiles = profilesRaw ? JSON.parse(profilesRaw) : [];
      const gmailAccounts = crmProfiles.filter(p => p.type === 'gmail');

      // Fallback: if no profiles yet, check the legacy single-account key
      if (gmailAccounts.length === 0) {
        const email = await get("gmail:email");
        const expiresAt = parseInt(await get("gmail:expires_at") || "0");
        return res.json({
          connected: !!email,
          email: email || null,
          tokenExpired: expiresAt > 0 && Date.now() > expiresAt,
          accounts: email ? [{ id: 'gmail_legacy', email, user: email, name: email, active: true, type: 'gmail', dailyCap: 500 }] : [],
        });
      }

      return res.json({
        connected: gmailAccounts.length > 0,
        email: gmailAccounts[0]?.email || null,
        accounts: gmailAccounts,
      });
    } catch(e) {
      return res.json({ connected: false, email: null, accounts: [] });
    }
  }

  // ── GMAIL DISCONNECT ───────────────────────────────────────────────────
  if (type === "disconnect" && req.method === "POST") {
    try {
      const { email } = req.body || {};
      if (email) {
        const suffix = `:${email.replace(/[^a-z0-9]/gi, '_')}`;
        await Promise.all([
          set(`gmail:access_token${suffix}`, ''),
          set(`gmail:refresh_token${suffix}`, ''),
          set(`gmail:expires_at${suffix}`, '0'),
        ]);
        // Remove from crm:profiles
        const profilesRaw = await get('crm:profiles');
        const crmProfiles = profilesRaw ? JSON.parse(profilesRaw) : [];
        const updated = crmProfiles.filter(p => !(p.type === 'gmail' && p.user === email));
        await set('crm:profiles', JSON.stringify(updated));
        console.log(`✅ Gmail disconnected: ${email}`);
      }
      return res.json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(400).json({ error: "Invalid type parameter. Use ?type=auth, ?type=callback, ?type=status, or ?type=disconnect" });
};