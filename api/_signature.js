// api/_signature.js — shared helpers for using the sender's real Gmail signature.
// Underscore prefix = shared module, not a route.
//
// Gmail's API does NOT append the web-UI signature to messages sent through it,
// so we read it from Settings → "Send mail as" (users.settings.sendAs.get, which
// the gmail.readonly scope we already request covers) and append it ourselves.

const CACHE_MS = 10 * 60 * 1000;
const cache    = new Map(); // address(lowercase) -> { html, exp }

// Returns the signature HTML for the first address that exists as a "send as"
// identity on the connected Gmail account. An address with an empty signature
// returns '' (we do NOT fall through to the next address — the user chose none).
// Never throws: any failure returns '' so the email still sends.
async function getGmailSignature(accessToken, ...addresses) {
  for (const addr of addresses.filter(Boolean)) {
    const key = String(addr).toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.html;

    try {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(addr)}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) }
      );
      if (r.status === 404) continue;           // not a send-as identity here — try next address
      if (!r.ok) {
        console.warn(`✉️ [SIGNATURE] sendAs lookup for ${addr} failed: HTTP ${r.status} — sending without signature`);
        return '';                              // not cached, so a re-sync/fix is picked up immediately
      }
      const data = await r.json();
      const html = String(data.signature || '').trim();
      cache.set(key, { html, exp: Date.now() + CACHE_MS });
      return html;
    } catch (e) {
      console.warn(`✉️ [SIGNATURE] lookup error for ${addr}: ${e.message} — sending without signature`);
      return '';
    }
  }
  return '';
}

// ── Sign-off detection ───────────────────────────────────────────────────────
// AI-generated bodies end with "Best,\nPawan Kumar\nEnginerds Tech Solution".
// When a real Gmail signature is appended, that name block would be duplicated.
const CLOSERS = /^(best|best regards|kind regards|warm regards|regards|thanks|thank you|many thanks|cheers|sincerely|yours sincerely|yours truly),?$/i;

// A "sign-off paragraph" = a closing word followed by at most 3 short name/company
// lines (no links, emails or long numbers). Returns the closing line, or null.
function signOffCloser(para) {
  const lines = String(para).split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length || !CLOSERS.test(lines[0])) return null;
  const rest = lines.slice(1);
  const looksLikeName = rest.length <= 3 && rest.every(l => l.length <= 50 && !/https?:|www\.|@|\d{5,}/i.test(l));
  return looksLikeName ? lines[0] : null;
}

module.exports = { getGmailSignature, signOffCloser };
