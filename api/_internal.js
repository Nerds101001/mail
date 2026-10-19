// api/_internal.js — who may use the mail-sending endpoints (shared module, not a route).
//
// /api/send-email and /api/send-smtp send real email from the connected accounts, so they accept
// only:
//   1. a logged-in CRM user  — "Authorization: Bearer <session token>" that exists in the sessions
//      table (strict lookup: no token / unknown token / the legacy "short token = admin" shortcut
//      are all rejected), or
//   2. the server's own jobs — scheduled campaigns, drip follow-ups, the next-day retry job — which
//      present INTERNAL_KEY. It is random, created when the server starts and only ever held in
//      memory (nginx makes every request look like it comes from 127.0.0.1, so an IP check would
//      not work). Set INTERNAL_API_KEY to pin it instead.

const crypto = require("crypto");
const { sessionUserId } = require("./_signature");

const INTERNAL_KEY = process.env.INTERNAL_API_KEY || crypto.randomBytes(32).toString("hex");

function isInternalCall(req) {
  const given = String(req.headers?.["x-internal-key"] || "");
  const a = Buffer.from(given), b = Buffer.from(INTERNAL_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Session lookups are cached for a minute so a 500-email campaign doesn't query the DB 500 times.
// A logged-out/expired session therefore stops working within a minute.
const sessionCache = new Map();   // token -> expiry ms
async function validSession(token) {
  const hit = sessionCache.get(token);
  if (hit && hit > Date.now()) return true;
  const uid = await sessionUserId(token);
  if (uid) {
    if (sessionCache.size > 500) sessionCache.clear();
    sessionCache.set(token, Date.now() + 60000);
    return true;
  }
  sessionCache.delete(token);
  return false;
}

// Express middleware for the two sending routes.
async function requireSendAuth(req, res, next) {
  try {
    if (isInternalCall(req)) return next();
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (token && await validSession(token)) return next();
  } catch (e) {
    console.error("send-auth check failed:", e.message);
  }
  // kind:"auth" lets the campaign runner PAUSE (leads stay queued) instead of failing every lead.
  return res.status(401).json({ success: false, error: "Login required — please sign in again.", reason: "Login required", kind: "auth" });
}

// The server calling its own sending endpoint (same machine, no internet round-trip).
async function internalFetch(path, payload, { timeoutMs = 60000 } = {}) {
  return fetch(`http://127.0.0.1:${process.env.PORT || 3000}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

module.exports = { requireSendAuth, internalFetch, isInternalCall, INTERNAL_KEY };
