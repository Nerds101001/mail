// api/_sendable.js — which leads may be e-mailed at all (shared module, not a route).
//
// KEEP IN STEP with isSendable() in crm-ui/src/utils.js — the campaign screen, "Requeue unsent" and the
// Drip list use that copy, scheduled campaigns use this one.
//
// A lead is NOT sendable when it is: soft-deleted, has no e-mail address, has a status that says the
// address is bad or gone (INVALID, INVALID-LENGTH, TYPO, DISPOSABLE, DUPLICATE, BOUNCED) or is
// UNSUBSCRIBED (status or pipeline stage), or sits in the NOT-INTERESTED stage.
// WON / LOST / REPLIED etc. stay sendable on purpose — whether to mail them is the user's call.
//
// This is a first filter when a campaign's audience is built. The hard stop for opted-out addresses
// is still the opt_outs table checked inside /api/send-email and /api/send-smtp.

const BAD_STATUS = new Set(["INVALID", "INVALID-LENGTH", "TYPO", "DISPOSABLE", "DUPLICATE", "BOUNCED", "UNSUBSCRIBED"]);
const BAD_STAGE  = new Set(["UNSUBSCRIBED", "NOT-INTERESTED"]);

function isSendable(lead) {
  if (!lead || typeof lead !== "object") return false;
  if (lead.deleted) return false;
  if (!String(lead.email || "").trim()) return false;
  if (BAD_STATUS.has(String(lead.status || "").toUpperCase())) return false;
  if (BAD_STAGE.has(String(lead.pipelineStage || "").toUpperCase())) return false;
  return true;
}

module.exports = { isSendable };
