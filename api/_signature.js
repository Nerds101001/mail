// api/_signature.js — email signatures (shared module, not a route).
//
// Two sources, in priority order, for every outgoing email:
//   1. An HTML signature the user uploaded in Settings (stored per CRM user).
//   2. Gmail senders only: the signature set in Gmail → "Send mail as".
//      (Gmail's API does not append it for us — we read it via
//      users.settings.sendAs.get, covered by the gmail.readonly scope.)
//
// Placement: after the closing line ("Best,"). The AI's typed name/company
// lines under the closing word are replaced by the signature so it never shows
// twice; with no sign-off in the body it is appended after the last paragraph.

const { get, set, del } = require("./_redis");
const { getSql }        = require("./_db");

const MAX_UPLOAD_BYTES    = 300 * 1024;  // raw file
const MAX_SIGNATURE_BYTES = 60 * 1024;   // after sanitising (Gmail clips messages > ~102 KB)

// ── Storage (same per-user key convention as the rest of the CRM) ────────────
function sigKey(userId) {
  return !userId || userId === "admin" ? "crm:signature" : `crm:signature:${userId}`;
}

async function getUploadedSignature(userId) {
  try {
    const raw = await get(sigKey(userId));
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o.html === "string" && o.html ? o : null;
  } catch { return null; }
}

// ── Whose signature? ─────────────────────────────────────────────────────────
// Strict session lookup. Unlike ops.js getUserIdFromToken, a missing / unknown
// token is NOT treated as admin.
async function sessionUserId(token) {
  if (!token) return null;
  try {
    const rows = await getSql()`SELECT user_id FROM sessions WHERE token = ${token} AND expires_at > ${Date.now()} LIMIT 1`;
    return rows[0]?.user_id || null;
  } catch { return null; }
}

// The send endpoints get no auth token from scheduled/server-side callers, so:
// campaign owner → logged-in session (single sends from Leads) → explicit userId
// (drip enrollments) → admin.
async function resolveSignatureUser({ campaignId, authorization, userId } = {}) {
  try {
    if (campaignId) {
      const r = await getSql()`SELECT user_id FROM campaigns WHERE id = ${campaignId} LIMIT 1`;
      if (r[0]?.user_id) return r[0].user_id;
    }
    const s = await sessionUserId(String(authorization || "").replace(/^Bearer\s+/i, ""));
    if (s) return s;
  } catch { /* fall through */ }
  return userId || "admin";
}

// ── Sanitising an uploaded signature file ────────────────────────────────────
// Defence in depth: the Settings preview is a sandboxed iframe and mail clients
// strip active content anyway, but we never store/send script or form markup.
function userError(msg) { return Object.assign(new Error(msg), { userFacing: true }); }

function sanitizeSignatureHtml(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw userError("The file is empty.");
  if (Buffer.byteLength(raw) > MAX_UPLOAD_BYTES) throw userError("File is too large (max 300 KB).");

  const warnings = [];
  let html = raw.replace(/^﻿/, "");

  // Checked on the raw file: styles in <head> are dropped with the head below.
  if (/<style\b/i.test(html)) warnings.push("A <style> block was removed. Use inline style=\"\" attributes so the signature looks the same in every email client.");

  // Keep only what is inside <body> (a full HTML document can't be nested in an email).
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
  html = body
    ? body[1]
    : html.replace(/<!doctype[^>]*>/gi, "").replace(/<head[\s\S]*?<\/head\s*>/gi, "").replace(/<\/?(?:html|body)\b[^>]*>/gi, "");

  html = html.replace(/<!--[\s\S]*?-->/g, "");   // comments, incl. Outlook conditionals

  if (/<script\b/i.test(html)) warnings.push("Scripts were removed (email clients block them anyway).");
  html = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*>/gi, "");

  html = html.replace(/<style\b[\s\S]*?<\/style\s*>/gi, "");

  // Elements that must never ship in an email signature. Paired tags first, then strays / void tags.
  html = html.replace(/<(iframe|object|embed|form|textarea|select|button|svg|video|audio|canvas|noscript|title)\b[\s\S]*?<\/\1\s*>/gi, "");
  html = html.replace(/<\/?(?:iframe|object|embed|form|textarea|select|button|svg|video|audio|canvas|noscript|title|input|meta|link|base)\b[^>]*>/gi, "");

  // Event handlers (onclick=, onerror=, …) and script-ish URLs.
  for (let i = 0; i < 2; i++) html = html.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/\b(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi, "$1=$2#$2");

  html = html.trim();
  if (!html.replace(/<[^>]*>/g, "").trim() && !/<img\b/i.test(html)) throw userError("The file has no visible content.");
  if (Buffer.byteLength(html) > MAX_SIGNATURE_BYTES) {
    throw userError("Signature is too large (max 60 KB of HTML). Host big images online and link to them instead of embedding them.");
  }

  // Images: a recipient can only see images served from a public https URL.
  const srcs = [...html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map(m => (m[1] ?? m[2] ?? m[3] ?? "").trim());
  const embedded = srcs.filter(s => /^data:/i.test(s)).length;
  const insecure = srcs.filter(s => /^http:\/\//i.test(s)).length;
  const local    = srcs.filter(s => s && !/^(https?:|data:)/i.test(s)).length;
  if (embedded) warnings.push(`${embedded} image(s) are embedded in the file (data:). Gmail and Outlook block these. Host the images online and use https:// links.`);
  if (local)    warnings.push(`${local} image(s) use a local path (e.g. "logo.png" or "cid:"). Recipients will see broken images. Upload them to your website and use full https:// URLs.`);
  if (insecure) warnings.push(`${insecure} image(s) use http://. Switch them to https:// so they load everywhere.`);

  const links = (html.match(/<a\b[^>]*\bhref\s*=/gi) || []).length;
  return { html, warnings, stats: { images: srcs.length, links, bytes: Buffer.byteLength(html) } };
}

// ── Gmail signature (fallback when nothing was uploaded) ─────────────────────
const GMAIL_CACHE_MS = 10 * 60 * 1000;
const gmailCache     = new Map(); // address(lowercase) -> { html, exp }

// Returns the signature HTML of the first address that exists as a "send as"
// identity on the connected account. An identity with an EMPTY signature returns
// '' — we do not fall through to another identity's signature (that could put
// someone else's name on the email). Never throws: any failure returns ''.
async function getGmailSignature(accessToken, ...addresses) {
  for (const addr of addresses.filter(Boolean)) {
    const key = String(addr).toLowerCase();
    const hit = gmailCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.html;
    try {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(addr)}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) }
      );
      if (r.status === 404) continue;          // not a send-as identity here — try next address
      if (!r.ok) {
        console.warn(`✉️ [SIGNATURE] sendAs lookup for ${addr} failed: HTTP ${r.status} — sending without Gmail signature`);
        return "";                             // not cached, so a re-sync/fix is picked up immediately
      }
      const html = String((await r.json()).signature || "").trim();
      gmailCache.set(key, { html, exp: Date.now() + GMAIL_CACHE_MS });
      return html;
    } catch (e) {
      console.warn(`✉️ [SIGNATURE] lookup error for ${addr}: ${e.message} — sending without Gmail signature`);
      return "";
    }
  }
  return "";
}

// Signature HTML for one outgoing email. gmail = { accessToken, addresses[] } or null (SMTP).
async function pickSignature({ userId, gmail = null }) {
  const up = await getUploadedSignature(userId);
  if (up) {
    // A saved-but-switched-off upload means "no signature" — don't fall back to Gmail's.
    const on = up.enabled !== false;
    console.log(`✉️ [SIGNATURE] user=${userId} source=${on ? "uploaded" : "off"}`);
    return on ? up.html : "";
  }
  if (gmail) {
    const g = await getGmailSignature(gmail.accessToken, ...gmail.addresses);
    console.log(`✉️ [SIGNATURE] user=${userId} source=${g ? "gmail" : "none"}`);
    return g;
  }
  console.log(`✉️ [SIGNATURE] user=${userId} source=none`);
  return "";
}

// ── Placement ────────────────────────────────────────────────────────────────
// AI bodies end with "Best,\nPawan Kumar\nEnginerds Tech Solution". A sign-off
// paragraph = a closing word followed by at most 3 short name/company lines (no
// links, emails or long numbers). Returns the closing line, or null.
const CLOSERS = /^(best|best regards|kind regards|warm regards|regards|thanks|thank you|many thanks|cheers|sincerely|yours sincerely|yours truly),?$/i;

function signOffCloser(para) {
  const lines = String(para).split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length || !CLOSERS.test(lines[0])) return null;
  const rest = lines.slice(1);
  const looksLikeName = rest.length <= 3 && rest.every(l => l.length <= 50 && !/https?:|www\.|@|\d{5,}/i.test(l));
  return looksLikeName ? lines[0] : null;
}

// rawParas = plain-text paragraphs. Returns the paragraphs (sign-off name lines
// dropped when a signature will replace them) and the index after which the
// signature block goes (-1 = none).
function placeSignature(rawParas, signatureHtml) {
  const paras = rawParas.slice();
  let sigAfter = -1;
  if (signatureHtml) {
    for (let i = paras.length - 1; i >= 0; i--) {
      const closer = signOffCloser(paras[i]);
      if (closer) { paras[i] = closer; sigAfter = i; break; }
    }
    if (sigAfter < 0) sigAfter = paras.length - 1;
  }
  return { paras, sigAfter };
}

const signatureBlock = (html) => (html ? `<div style="margin:0 0 14px 0;">${html}</div>` : "");

// ── HTTP: /api/ops?type=signature  (GET load · POST upload/toggle · DELETE remove)
async function handleRequest(req, res) {
  const token  = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.query.token;
  const userId = await sessionUserId(token);
  if (!userId) return res.status(401).json({ ok: false, error: "Please sign in again." });

  try {
    if (req.method === "GET") {
      return res.json({ ok: true, signature: await getUploadedSignature(userId) });
    }
    if (req.method === "DELETE") {
      await del(sigKey(userId));
      return res.json({ ok: true, signature: null });
    }
    if (req.method === "POST") {
      const { html, fileName, enabled } = req.body || {};
      if (typeof html === "string") {
        const clean = sanitizeSignatureHtml(html);
        const signature = {
          html: clean.html,
          fileName: String(fileName || "signature.html").slice(0, 120),
          updatedAt: Date.now(),
          enabled: true,
        };
        await set(sigKey(userId), JSON.stringify(signature));
        console.log(`✉️ [SIGNATURE] saved for ${userId}: ${clean.stats.bytes}B, ${clean.stats.images} images, ${clean.warnings.length} warning(s)`);
        return res.json({ ok: true, signature, warnings: clean.warnings, stats: clean.stats });
      }
      if (typeof enabled === "boolean") {
        const cur = await getUploadedSignature(userId);
        if (!cur) return res.status(404).json({ ok: false, error: "No signature uploaded yet." });
        const signature = { ...cur, enabled };
        await set(sigKey(userId), JSON.stringify(signature));
        return res.json({ ok: true, signature });
      }
      return res.status(400).json({ ok: false, error: "Send the signature file as { html, fileName }." });
    }
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    if (e.userFacing) return res.status(400).json({ ok: false, error: e.message });
    console.error("✉️ [SIGNATURE] request failed:", e.message);
    return res.status(500).json({ ok: false, error: "Could not save the signature. Please try again." });
  }
}

module.exports = {
  // used by the senders
  pickSignature, resolveSignatureUser, placeSignature, signatureBlock,
  // building blocks (also used by tests)
  getUploadedSignature, getGmailSignature, signOffCloser, sanitizeSignatureHtml, sessionUserId,
  handleRequest,
};
