// api/_sendable.js — which leads may be e-mailed at all (shared module, not a route).
//
// KEEP IN STEP with isSendable() in crm-ui/src/utils.js — the campaign screen, "Requeue unsent" and the
// Drip list use that copy, scheduled campaigns use this one.
//
// A lead is NOT sendable when it is: soft-deleted, has no e-mail address, has a status that says the
// address is bad or gone (INVALID, INVALID-LENGTH, TYPO, DISPOSABLE, DUPLICATE, BOUNCED, FAILED) or is
// UNSUBSCRIBED (status or pipeline stage), or sits in the NOT-INTERESTED stage.
// WON / LOST / REPLIED stay sendable on purpose — whether to mail them is the user's call.
//
// RULE (owner's decision, 2026-11-06): an address whose e-mail FAILED or BOUNCED is never mailed again —
// no next-day retry, no next campaign. The record of that is the campaign_leads rows with status
// FAILED / BOUNCED; `hasFailedBefore()` is checked inside /api/send-email and /api/send-smtp (so every
// route obeys it) and `applyFailedOverlay()` keeps the CRM lead records showing it.
// To mail such a person again, correct their e-mail address (a new address has no failed history).

const { getSql } = require("./_db");

const BAD_STATUS = new Set(["INVALID", "INVALID-LENGTH", "TYPO", "DISPOSABLE", "DUPLICATE", "BOUNCED", "FAILED", "UNSUBSCRIBED"]);
const BAD_STAGE  = new Set(["UNSUBSCRIBED", "NOT-INTERESTED"]);

function isSendable(lead) {
  if (!lead || typeof lead !== "object") return false;
  if (lead.deleted) return false;
  if (!String(lead.email || "").trim()) return false;
  if (BAD_STATUS.has(String(lead.status || "").toUpperCase())) return false;
  if (BAD_STAGE.has(String(lead.pipelineStage || "").toUpperCase())) return false;
  return true;
}

const norm = e => String(e || "").trim().toLowerCase();

// Has a send to this address ever FAILED or BOUNCED? (any campaign, any user)
async function hasFailedBefore(email) {
  const lc = norm(email);
  if (!lc) return false;
  const r = await getSql()`SELECT status FROM campaign_leads WHERE lower(trim(lead_email)) = ${lc} AND status IN ('FAILED', 'BOUNCED') LIMIT 1`;
  return r.length ? r[0].status : false;
}

// email_lc → 'BOUNCED' | 'FAILED' for every address that ever failed (BOUNCED wins over FAILED).
async function failedAddresses() {
  const rows = await getSql()`SELECT lower(trim(lead_email)) AS lc, bool_or(status = 'BOUNCED') AS bounced
                              FROM campaign_leads WHERE status IN ('FAILED', 'BOUNCED') AND coalesce(trim(lead_email), '') <> '' GROUP BY 1`;
  const m = new Map();
  for (const r of rows) m.set(r.lc, r.bounced ? "BOUNCED" : "FAILED");
  return m;
}

// Make lead records agree with the failed-send history (used on CRM load and save, like the opt-out
// overlay, so a stale browser tab cannot put a failed address back to VALID). Statuses that already say
// "don't mail" are left alone; everything else (VALID, SENT, FOLLOW-UP, REPLIED…) becomes FAILED/BOUNCED.
async function applyFailedOverlay(leads) {
  if (!Array.isArray(leads) || !leads.length) return { leads, changed: 0 };
  const failed = await failedAddresses();
  if (!failed.size) return { leads, changed: 0 };
  let changed = 0;
  const out = leads.map(l => {
    if (!l || !l.email) return l;
    const want = failed.get(norm(l.email));
    if (!want) return l;
    const cur = String(l.status || "").toUpperCase();
    if (cur === want || BAD_STATUS.has(cur)) return l;
    changed++;
    return { ...l, status: want };
  });
  return { leads: changed ? out : leads, changed };
}

module.exports = { isSendable, hasFailedBefore, failedAddresses, applyFailedOverlay, BAD_STATUS };
