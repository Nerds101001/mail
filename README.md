# AI Lead Engine — Web Edition
### Enginerds Tech Solution CRM with Gmail OAuth + Real Email Tracking

---

## What This Does
- **Send real emails** via your Gmail account (OAuth — no password stored)
- **Track email opens** automatically via invisible tracking pixel
- **Track link clicks** via redirect tracking
- **AI-personalized emails** via Claude API
- **Full CRM** — leads, pipeline, follow-up sequences, dashboard

---

## Folder Structure
```
lead-engine/
├── index.html              ← Frontend app (the whole UI)
├── package.json
├── vercel.json
└── api/
    ├── _redis.js           ← Shared Redis helper (Upstash)
    ├── gmail-auth.js       ← Step 1: redirect to Google OAuth
    ├── gmail-callback.js   ← Step 2: exchange code for tokens
    ├── send-email.js       ← Send email via Gmail API
    ├── tracking-stats.js   ← Get open/click counts + Gmail status
    └── track/
        ├── open.js         ← Tracking pixel (increments open count)
        └── click.js        ← Click redirect (increments click count)
```

---

## Step-by-Step Deployment

### STEP 1 — Set up Upstash Redis (free, 2 min)
Used to store Gmail tokens and email tracking data.

1. Go to **https://upstash.com** → Sign up free
2. Click **Create Database** → choose region closest to you
3. Copy **REST URL** and **REST Token** from the dashboard
4. Save these — you'll need them in Step 4

---

### STEP 2 — Set up Google OAuth (10 min)
This lets users connect their Gmail account.

1. Go to **https://console.cloud.google.com**
2. Create a new project (or use existing)
3. Go to **APIs & Services → Enable APIs**
   - Search and enable: **Gmail API**
4. Go to **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: `Enginerds Lead Engine`
   - Add your email as test user
   - Scopes: add `gmail.send`, `gmail.readonly`, `userinfo.email`
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `https://YOUR-APP.vercel.app/api/gmail-callback`
     *(You'll update this once Vercel gives you a URL — you can do a temporary deploy first)*
6. Copy **Client ID** and **Client Secret** — save for Step 4

---

### STEP 3 — Deploy to Vercel (5 min)

#### Option A: GitHub (recommended)
1. Push this folder to a GitHub repo
2. Go to **https://vercel.com** → New Project → Import your repo
3. Framework: **Other** (no framework)
4. Click Deploy — you'll get a URL like `https://lead-engine-xyz.vercel.app`

#### Option B: Vercel CLI
```bash
npm install -g vercel
cd lead-engine
vercel
# Follow prompts → choose "Other" framework
```

---

### STEP 4 — Add Environment Variables in Vercel

Go to your Vercel project → **Settings → Environment Variables** → add all of these:

| Variable | Value | Where to get it |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `123456-abc.apps.googleusercontent.com` | Google Cloud Console (Step 2) |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-xxxxx` | Google Cloud Console (Step 2) |
| `APP_URL` | `https://your-app.vercel.app` | Your Vercel deployment URL |
| `UPSTASH_REDIS_REST_URL` | `https://xxx.upstash.io` | Upstash dashboard (Step 1) |
| `UPSTASH_REDIS_REST_TOKEN` | `AXxx...` | Upstash dashboard (Step 1) |

After adding all vars → **Redeploy** (Vercel dashboard → Deployments → Redeploy latest)

---

### STEP 5 — Update Google OAuth Redirect URI
Now that you have your real Vercel URL:

1. Go back to Google Cloud Console → Credentials → your OAuth client
2. Add redirect URI: `https://YOUR-ACTUAL-APP.vercel.app/api/gmail-callback`
3. Save

---

### STEP 6 — Connect Gmail in the App
1. Open your deployed app
2. Go to **Settings**
3. Click **Connect Gmail** → sign in with Google → allow permissions
4. You'll be redirected back with "Gmail Connected ✓"
5. (Optional) Add your Claude API key for AI email generation

---

## How Tracking Works

### Open Tracking
Every email sent via this app contains a hidden 1×1 pixel image:
```html
<img src="https://your-app.vercel.app/api/track/open?id=lead_123" width="1" height="1" style="display:none"/>
```
When the recipient's email client loads the email, it fetches this image.
The `/api/track/open` endpoint increments the counter in Redis.

### Click Tracking
Links in emails are automatically wrapped:
```
https://your-app.vercel.app/api/track/click?id=lead_123&url=https://enginerds.in
```
When clicked → counter increments → user is redirected to the real URL.

### Syncing Counts
In the **Tracking** page, click **↻ Sync from Server** to pull latest open/click counts from Redis into the app.

> **Important:** Many email clients (especially Gmail and Outlook) block tracking pixels by default. Open tracking works best for business email clients like Outlook Desktop.

---

## Adding More Allowed Click Domains
Edit `api/track/click.js` and add domains to the `ALLOWED_DOMAINS` array:
```javascript
const ALLOWED_DOMAINS = [
  "enginerds.in",
  "www.enginerds.in",
  "youranotherdomain.com",  // ← add here
];
```

---

## Local Development
```bash
npm install -g vercel
cd lead-engine
npm install

# Create .env.local with your variables
cp .env.example .env.local
# (edit .env.local with your actual values)

vercel dev
# App runs at http://localhost:3000
```

---

## Free Tier Limits
| Service | Free Limit |
|---|---|
| Vercel | 100GB bandwidth, unlimited deployments |
| Upstash Redis | 10,000 commands/day, 256MB storage |
| Gmail API | 500 emails/day per user (free Gmail), 2000/day (Google Workspace) |

For higher volume, use SendGrid or AWS SES instead of Gmail API.

---

## Questions?
Contact: contact@enginerds.in
