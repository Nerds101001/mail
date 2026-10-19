// api/_sendErrors.js — says WHY a send failed, so the campaign runner can react correctly.
// (shared module, not a route)
//
//   kind = 'sender'    the sending ACCOUNT is the problem (expired Gmail token, wrong SMTP
//                      password…). Nothing was sent. Skip this account, try the lead on another.
//   kind = 'transient' temporary problem, nothing was sent (Gmail 5xx, SMTP 4xx, couldn't
//                      connect). Safe to try again tomorrow.
//   kind = 'unknown'   the outcome is NOT certain (timeout/reset mid-send, network error). The
//                      mail may have been delivered, so it is NEVER retried automatically —
//                      a retry could send the same email twice.
//   Permanent problems (bad address) are reported as bounced:true by the senders instead.

// Gmail API error response (HTTP code + message from the JSON body)
function classifyGmailApiError(code, message) {
  const msg = String(message || '');
  if (code === 400 && /invalid.*(to|recipient|address)|recipient address|invalid to header/i.test(msg)) return 'permanent';
  if (code === 401 || code === 403) return 'sender';
  if (code >= 500 && code < 600)    return 'transient';
  return 'unknown';
}

// An exception thrown inside send-email.js (token refresh etc.)
function classifyGmailThrown(message) {
  return /connection expired|reconnect|not connected|token refresh failed|failed to refresh|invalid_grant|invalid credentials|unauthorized|login required/i.test(String(message || ''))
    ? 'sender' : 'unknown';
}

// nodemailer error from send-smtp.js (rate-limit and 5xx-bounce cases are handled before this)
function classifySmtpError(err) {
  const msg  = String(err?.message || '');
  const code = err?.responseCode || 0;
  const c    = err?.code || '';
  if (c === 'EAUTH' || [530, 534, 535].includes(code) || /authentication|invalid login|auth.*fail|credentials/i.test(msg)) return 'sender';
  // Never reached the server → nothing was sent → safe.
  if (err?.command === 'CONN' || ['ECONNREFUSED', 'ENOTFOUND', 'EDNS', 'EAI_AGAIN'].includes(c) || /getaddrinfo|ECONNREFUSED|ENOTFOUND/.test(msg)) return 'transient';
  if (code >= 400 && code < 500) return 'transient';   // 4xx = server refused the message for now
  return 'unknown';                                    // timeout / reset mid-conversation: may have been delivered
}

module.exports = { classifyGmailApiError, classifyGmailThrown, classifySmtpError };
