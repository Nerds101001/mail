// api/gmail.js — Combined Gmail OAuth handler (per-user profiles)
// GET  /api/gmail?type=auth&token=   → Step 1: redirect to Google OAuth (token = CRM session token)
// GET  /api/gmail?type=callback      → Step 2: handle OAuth callback (userId encoded in state)
// GET  /api/gmail?type=status        → Check Gmail connection status for the calling user
// POST /api/gmail?type=disconnect    → Disconnect a Gmail account for the calling user

const { get, set } = require("./_redis");
const { neon } = require("@neondatabase/serverless");

// ── Shared helpers (same as crm.js) ──────────────────────────────────────────
async function getUserIdFromToken(token) {
  if (!token) return "admin";
  if (/^sess_\d+_[a-z0-9]+$/.test(token) && token.length < 40) return "admin";
  try {
    const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
    const rows = await sql`SELECT user_id FROM sessions WHERE token = ${token} AND expires_at > ${Date.now()} LIMIT 1`;
    return rows[0]?.user_id || "admin";
  } catch { return "admin"; }
}

function ns(key, userId) {
  if (!userId || userId === "admin") return key;
  return `${key}:${userId}`;
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, code, state } = req.query;

  // Resolve calling user from Authorization header or token query param
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
  const userId = await getUserIdFromToken(token);

  // ── STEP 1: REDIRECT TO GOOGLE OAUTH ──────────────────────────────────
  if (type === "auth") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    let appUrl = (process.env.APP_URL || '').replace(/^["']|["']$/g, '').trim();
    if (appUrl && !appUrl.startsWith('http')) appUrl = 'https://' + appUrl;

    if (!clientId || !appUrl) {
      return res.status(500).json({ error: "Missing GOOGLE_CLIENT_ID or APP_URL env vars" });
    }

    const redirectUri = `${appUrl}/api/gmail?type=callback`;

    // Encode userId + nonce in state so callback knows which user is connecting
    const statePayload = Buffer.from(JSON.stringify({
      userId,
      nonce: Math.random().toString(36).slice(2),
    })).toString('base64');

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email",
      ].join(" "),
      access_type: "offline",
      prompt:      "consent",
      state:       statePayload,
    });

    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  // ── STEP 2: HANDLE OAUTH CALLBACK ─────────────────────────────────────
  if (type === "callback") {
    let appUrl = (process.env.APP_URL || '').replace(/^["']|["']$/g, '').trim();
    if (appUrl && !appUrl.startsWith('http')) appUrl = 'https://' + appUrl;
    const redirectUri = `${appUrl}/api/gmail?type=callback`;

    if (!code) {
      return res.redirect(`${appUrl}/?gmail=error&msg=${encodeURIComponent("Authorization code missing")}`);
    }

    // Decode which user triggered this OAuth flow
    let callbackUserId = "admin";
    try {
      if (state) {
        const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
        callbackUserId = decoded.userId || "admin";
      }
    } catch { /* use admin as fallback */ }

    try {
      // Exchange authorization code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri:  redirectUri,
          grant_type:    "authorization_code",
        }),
      });

      const tokens = await tokenRes.json();
      if (tokens.error) throw new Error(tokens.error_description || tokens.error);

      // Get Gmail account info
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileRes.json();

      // Store tokens — keyed by email address (global, email is unique)
      const suffix = profile.email ? `:${profile.email.replace(/[^a-z0-9]/gi, '_')}` : '';
      await Promise.all([
        set(`gmail:access_token${suffix}`, tokens.access_token),
        set(`gmail:refresh_token${suffix}`, tokens.refresh_token),
        set(`gmail:expires_at${suffix}`,   String(Date.now() + tokens.expires_in * 1000)),
        set("gmail:email", profile.email), // legacy key, keep for backward compat
      ]);

      // ── Save Gmail profile into THIS user's crm:profiles ──────────────
      try {
        const profilesKey = ns("crm:profiles", callbackUserId);
        const profilesRaw = await get(profilesKey);
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
        await set(profilesKey, JSON.stringify(crmProfiles));
        console.log(`✅ Gmail connected: ${profile.email} → user: ${callbackUserId}`);
      } catch(profileErr) {
        console.warn('⚠ Could not update crm:profiles with Gmail account:', profileErr.message);
      }

      res.redirect(`${appUrl}/?gmail=connected&account=${encodeURIComponent(profile.email)}`);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.redirect(`${appUrl}/?gmail=error&msg=${encodeURIComponent(err.message)}`);
    }
    return;
  }

  // ── GMAIL STATUS (returns all accounts for the calling user) ──────────
  if (type === "status") {
    try {
      const profilesKey = ns("crm:profiles", userId);
      const profilesRaw = await get(profilesKey);
      const crmProfiles = profilesRaw ? JSON.parse(profilesRaw) : [];
      const gmailAccounts = crmProfiles.filter(p => p.type === 'gmail');

      // Fallback: if admin and no profiles yet, check legacy single-account key
      if (gmailAccounts.length === 0 && userId === "admin") {
        const email     = await get("gmail:email");
        const expiresAt = parseInt(await get("gmail:expires_at") || "0");
        return res.json({
          connected: !!email,
          email:     email || null,
          tokenExpired: expiresAt > 0 && Date.now() > expiresAt,
          accounts: email ? [{ id:'gmail_legacy', email, user:email, name:email, active:true, type:'gmail', dailyCap:500 }] : [],
        });
      }

      return res.json({
        connected: gmailAccounts.length > 0,
        email:     gmailAccounts[0]?.email || null,
        accounts:  gmailAccounts,
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
        // Clear OAuth tokens (global, keyed by email)
        await Promise.all([
          set(`gmail:access_token${suffix}`, ''),
          set(`gmail:refresh_token${suffix}`, ''),
          set(`gmail:expires_at${suffix}`,   '0'),
        ]);
        // Remove from THIS user's crm:profiles
        const profilesKey = ns("crm:profiles", userId);
        const profilesRaw = await get(profilesKey);
        const crmProfiles = profilesRaw ? JSON.parse(profilesRaw) : [];
        const updated = crmProfiles.filter(p => !(p.type === 'gmail' && p.user === email));
        await set(profilesKey, JSON.stringify(updated));
        console.log(`✅ Gmail disconnected: ${email} from user: ${userId}`);
      }
      return res.json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(400).json({ error: "Use ?type=auth | callback | status | disconnect" });
};
