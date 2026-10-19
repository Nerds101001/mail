// api/_retry.js — next-day retry policy (shared module, not a route).
//
// A failed email is NEVER re-sent in the same run/day. If the failure was temporary
// (nothing was sent), it is scheduled for the next day at RETRY_HOUR_IST and retried by
// the server job in _retryJob.js, up to MAX_ATTEMPTS attempts in total.
//
// Env knobs:  AUTO_RETRY=0 (switch the whole feature off) · RETRY_HOUR_IST (default 10)
//             RETRY_MAX_ATTEMPTS (default 3 = first send + 2 retries)

const IST_MS         = 330 * 60000;   // India has no DST
const RETRY_HOUR_IST = Number.isFinite(parseInt(process.env.RETRY_HOUR_IST, 10)) ? parseInt(process.env.RETRY_HOUR_IST, 10) : 10;
const SEND_END_IST   = 20;            // automatic sends only between RETRY_HOUR_IST and 20:00 IST
const MAX_ATTEMPTS   = Math.max(1, parseInt(process.env.RETRY_MAX_ATTEMPTS || "3", 10) || 3);

const retryEnabled = () => process.env.AUTO_RETRY !== "0";

// Tomorrow at RETRY_HOUR_IST (UTC ms). "Tomorrow" = the next calendar day in India.
function nextRetryAt(now = Date.now()) {
  const istDay = Math.floor((now + IST_MS) / 86400000);
  return (istDay + 1) * 86400000 + RETRY_HOUR_IST * 3600000 - IST_MS;
}

// Automatic sending only happens in business hours (India), never at night.
function inSendWindow(now = Date.now()) {
  const hour = Math.floor((((now + IST_MS) % 86400000) + 86400000) % 86400000 / 3600000);
  return hour >= RETRY_HOUR_IST && hour < SEND_END_IST;
}

// Columns the retry logic needs (idempotent; remembered after the first success).
let ensured = null;
function ensureRetryColumns(sql) {
  if (!ensured) {
    ensured = (async () => {
      const ddl = [
        "ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS failure_reason TEXT",
        "ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS message_id TEXT",
        "ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS sender_email TEXT",
        "ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0",
        "ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS retry_at BIGINT",
        "CREATE INDEX IF NOT EXISTS idx_campaign_leads_retry ON campaign_leads (retry_at) WHERE retry_at IS NOT NULL",
      ];
      for (const q of ddl) await sql.unsafe(q);
    })().catch(e => { ensured = null; throw e; });
  }
  return ensured;
}

module.exports = { nextRetryAt, inSendWindow, ensureRetryColumns, retryEnabled, MAX_ATTEMPTS, RETRY_HOUR_IST };
