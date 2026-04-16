# Enginerds CRM — TODO List

## 🔴 High Priority

### Lead Scraper (Google Places API)
- [ ] Add `GOOGLE_PLACES_API_KEY` to Vercel env vars
- [ ] Build `api/scrape-leads.js` — Google Places Text Search API
  - Input: city/state (India dropdown) + industry keyword
  - AI expands industry to all variants (yoga → yoga class, yoga studio, yoga trainer, yoga coach, yoga certification, etc.)
  - Fetches: business name, address, phone, website, rating
  - Tries to extract email from website domain
  - Auto-adds as leads with category = industry
- [ ] Build `crm-ui/src/pages/Scraper.jsx`
  - India state dropdown → city dropdown (or free text)
  - Industry input with AI expansion preview
  - Results table with checkboxes → "Add Selected as Leads"
- [ ] Add Scraper to sidebar nav

### Scoring Formula Upgrade
- [ ] Current: role-based only (FOUNDER=90, CTO=75, SALES=70, else=40)
- [ ] Upgrade to multi-factor scoring:
  - Role weight (40 pts max)
  - Email opens (10 pts per open, max 20)
  - Link clicks (15 pts per click, max 30)
  - Company size signal from domain (10 pts)
  - Reply = +30 pts
  - Total max: 100

### Email Tracking Fix
- [ ] Opens/clicks not updating in Tracking page after sync
- [ ] Investigate: `incr` in Neon Postgres may be slow — check if tracking pixel fires correctly
- [ ] Add auto-sync on Tracking page load (not just manual button)

---

## 🟡 Medium Priority

### Lead Enrichment Upgrade
- [ ] Add more disposable email domains to the list
- [ ] Add LinkedIn URL field to lead profile
- [ ] Company size detection from domain (Clearbit-style)
- [ ] Better typo detection (more common misspellings)

### Campaign Improvements
- [ ] Schedule campaign for a specific date/time (not just run now)
- [ ] Per-lead send time optimization (send at 9am recipient's timezone)
- [ ] Campaign analytics page — open rate, click rate, reply rate per campaign
- [ ] Pause/resume campaign mid-run

### Client Module
- [ ] Renewal reminder email auto-send (not just digest)
- [ ] Invoice generation (PDF) for clients
- [ ] Payment history log per client

---

## 🟢 Nice to Have

- [ ] Dark mode toggle
- [ ] Mobile responsive improvements
- [ ] Bulk email validation via external API (ZeroBounce/NeverBounce)
- [ ] WhatsApp follow-up integration
- [ ] Export tracking report as PDF
- [ ] Team member accounts (multi-user with roles)
- [ ] Webhook for bounce/complaint handling from Gmail

---

## ✅ Completed
- [x] Login with team PIN
- [x] Dashboard with stats, tasks, pipeline overview
- [x] Lead management with pipeline stages
- [x] AI email generation (NVIDIA NIM Llama 3.1 70B)
- [x] Custom email mode with [Name][Company][Role] variables
- [x] Gmail OAuth multi-account support
- [x] SMTP multi-account round-robin
- [x] Email open/click tracking pixel
- [x] Unsubscribe handling
- [x] Client management with renewal dates
- [x] Deal/quotation/demo tracking
- [x] Daily task engine with email digest
- [x] React frontend redesign (light theme, Tailwind)
- [x] Neon Postgres as database (replaced Redis)
- [x] Email formatting with proper paragraphs
- [x] AI personalization using lead's actual name/company/industry
- [x] Campaign data persistence after send
