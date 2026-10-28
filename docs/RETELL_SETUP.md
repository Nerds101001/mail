# AI voice calls (Retell) — setup

The CRM talks to Retell in two directions: it STARTS outbound calls (`POST /api/calls?type=start`) and Retell
REPORTS every call back to `POST https://crm.enginerds.in/api/retell-webhook` (signed with your API key).
Code: `api/calls.js`, page `crm-ui/src/pages/Calls.jsx`, 📞 button in Leads.

## 1. Retell dashboard
1. **API key**: Dashboard → API Keys → create one. Put it ONLY in the server's `~/crm/.env`:
   ```
   RETELL_API_KEY=key_xxxxxxxx
   ```
2. **Phone number**: Dashboard → Phone Numbers → buy a US number (≈$2/month). Put it in `.env` in E.164 form:
   ```
   RETELL_FROM_NUMBER=+1415XXXXXXX
   ```
   For *inbound*, bind this number to the agent in the dashboard (Inbound agent = the agent below).
3. **Agent**: Dashboard → Agents → create a "Single prompt" (Retell LLM) agent.
   - Language: **Multiselect → English (India) + Hindi (IN)**. Pick a voice that has Hindi enabled (greyed-out voices don't).
   - Prompt: start from `docs/retell-agent-prompt.md` (uses the variables the CRM sends: `{{lead_name}}`, `{{company}}`, `{{role}}`, `{{notes}}`).
   - **Post-call analysis** (Agent → Post-call analysis): add a custom field
     `outcome` (type: single select / enum) with EXACTLY these values:
     `interested, callback, not_interested, do_not_call, no_answer, voicemail, other`
     The CRM reads `call_analysis.custom_analysis_data.outcome` and moves the lead:
     interested → DEMO · callback → HOT · not_interested → NOT-INTERESTED · do_not_call → opt-out (never mailed or called again).
   - Copy the agent id into `.env`: `RETELL_AGENT_ID=agent_xxxxxxxx`
4. **Webhook**: Dashboard → Settings → Webhook URL → `https://crm.enginerds.in/api/retell-webhook`
   (account-level, or per agent). Events: call_started, call_ended, call_analyzed.
5. Optional: `DEFAULT_COUNTRY_CODE=91` (default) — a bare 10-digit lead phone is dialled as +91.

Then restart the app: `pm2 restart crm --update-env`. The AI Calls page shows a yellow banner until all three variables are set.

## 2. Costs (Retell docs, Oct 2026)
- Retell voice/AI ≈ $0.07–0.10/min; calls **to India** from a Retell (Twilio) number +$0.15/min → ≈ ₹18–22/min all-in.
- New account: $10 credit ≈ 60–90 test minutes. Dashboard shows per-call cost; the CRM stores `cost_cents`.
- Inbound from India to a US number costs the CALLER an international call → for real inbound use an Indian number
  via Exotel/Plivo SIP trunk → Retell "custom telephony" (phase 2).

## 3. Rules the CRM enforces
- No call to a lead that opted out, is UNSUBSCRIBED or NOT-INTERESTED (HTTP 409).
- A lead who says "don't call me" (`do_not_call` or Retell's `user_requested_dnc`) is opted out everywhere.
- Webhooks are verified (HMAC over raw body + timestamp, 5-minute window) and idempotent (Retell retries 3×).
- TRAI: outbound AI calls only to people who gave you their number / existing leads; never cold lists.

## 4. Testing without spending
`GET /api/calls?type=status` (logged in) tells you what's configured. A fake signed webhook can be posted with
`node scripts/retell-fake-webhook.js` (see file) to see a call appear on the AI Calls page.
