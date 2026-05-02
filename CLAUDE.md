# Enginerds Lead Engine — Claude Instructions

## CRITICAL: Do not touch the tracking system without explicit permission

The email open/click tracking system took significant effort to get right.
Before changing ANY of the files below, run the test endpoint and confirm ALL PASSED:

**Test URL:** `https://enginerdsmail.vercel.app/api/test-tracking?e2e=1`

If it passes before your change and fails after, revert immediately.

---

## Tracking system — stable, do not modify

### Files that are locked
- `api/track-open.js` — serves tracking pixel, handles 302 redirect with unique token + Cache-Control: no-store
- `api/track-pixel.js` — serves the 1x1 GIF
- `api/track-click.js` — handles click redirect + tracking
- `api/_redis.js` → `trackOpen()` and `trackClick()` functions — the core tracking logic

### The IP classification logic (hard-won, do not change)
```
66.249.x.x  → ALWAYS BLOCK  (Google delivery pre-fetch, fires within 1-5s of send, always false)
74.125.x.x  → ALWAYS COUNT  (Google user proxy — fires when user actually opens Gmail)
64.233.x.x  → ALWAYS COUNT  (Google user proxy)
209.85.x.x  → ALWAYS COUNT  (Google user proxy)
216.58.x.x  → ALWAYS COUNT  (Google user proxy)
216.239.x.x → ALWAYS COUNT  (Google user proxy)
142.250.x.x → ALWAYS COUNT  (Google user proxy)
108.177.x.x → ALWAYS COUNT  (Google user proxy)
17.x.x.x    → ALWAYS COUNT  (Apple MPP — user-triggered)
40.94.x.x   → ALWAYS COUNT  (Microsoft SafeLinks — user-triggered)
40.107.x.x  → ALWAYS COUNT  (Microsoft SafeLinks — user-triggered)
52.100.x.x  → ALWAYS COUNT  (Microsoft SafeLinks — user-triggered)
Unknown IPs → 5s guard      (blocks anything within 5s of send)
```

### How tracking works (do not break this flow)
1. Email is sent → guard key written to DB **before** the Gmail/SMTP API call
2. Gmail delivers → Google's 66.249.x.x pre-fetches the pixel within 1-5s → **blocked**
3. User actually opens → Google's 74.125.x.x fetches the pixel → **counted**
4. `track-open.js` runs `trackOpen()` **before** calling `res.redirect()` — Vercel kills the function after response
5. 302 redirect uses a unique token so Gmail cannot cache the response
6. 30-second dedup prevents double-counting a single open session

### Tracking URLs must use query params (not path segments)
```
✅ /api/track-open?id=LEAD_ID&cid=CAMPAIGN_ID
❌ /api/track/open/LEAD_ID/CAMPAIGN_ID  ← Vercel rewrites lose path segments
```

### APP_URL must always have a fallback
```js
const appUrl = process.env.APP_URL || "https://enginerdsmail.vercel.app";
```
Never use `process.env.APP_URL` alone — if the env var is missing, pixel URLs break.

---

## Vercel constraints

- **Hobby plan: 12 serverless function limit.** Current count is exactly 12. Before adding a new `api/*.js` file, delete or merge an existing one.
- Functions in `api/_*.js` (underscore prefix) are shared modules, not counted as functions.
- `vercel.json` rewrites: the catch-all `/((?!api|assets|favicon|public).*)` → `/index.html` must stay last.

## Database

- Neon Postgres via `@neondatabase/serverless`
- Connection: `process.env.DATABASE_URL || process.env.POSTGRES_URL`
- Key tables: `simple_tracking` (cumulative per lead), `tracking_events` (per-event with campaign_id), `kv_store` (key-value), `campaign_leads`, `campaigns`
- Schema migrations: always use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — never drop `CREATE TABLE IF NOT EXISTS` blocks

## Adding new features safely

1. Run `https://enginerdsmail.vercel.app/api/test-tracking?e2e=1` before starting
2. Add new `api/` files only if under the 12-function limit
3. New features go in new files or extend existing non-tracking files (`ops.js`, `crm.js`)
4. Never modify `track-open.js`, `track-click.js`, `track-pixel.js`, or the `trackOpen`/`trackClick` functions in `_redis.js`
5. Run the test endpoint again after deploying — must still show ALL PASSED
