// api/_redis.js — Simplified Neon Postgres database helper
const { neon } = require("@neondatabase/serverless");

function getDb() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  return neon(url);
}

// Simplified retry wrapper
async function withRetry(operation, maxRetries = 2) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (e) {
      console.error(`DB operation failed (attempt ${i + 1}/${maxRetries}):`, e.message);
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// Simplified table initialization
let tablesInitialized = false;
async function ensureTable() {
  if (tablesInitialized) return;

  try {
    const sql = getDb();

    await sql`
      CREATE TABLE IF NOT EXISTS simple_tracking (
        lead_id TEXT PRIMARY KEY,
        opens INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        last_open BIGINT,
        last_click BIGINT
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at BIGINT DEFAULT NULL
      )
    `;

    // tracking_events must exist BEFORE trackOpen queries it to check duplicates
    await sql`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        lead_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        target_url TEXT,
        campaign_id TEXT,
        created_at BIGINT NOT NULL
      )
    `;
    // Migrate columns that didn't exist when the table was first created
    await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS campaign_id TEXT`.catch(() => {});
    await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS target_url TEXT`.catch(() => {});
    await sql`CREATE INDEX IF NOT EXISTS idx_tracking_events_lead ON tracking_events(lead_id, event_type, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tracking_events_campaign ON tracking_events(campaign_id)`.catch(() => {});
    // Composite index powers the per-campaign COUNT(*) subqueries in all-sends
    await sql`CREATE INDEX IF NOT EXISTS idx_tracking_events_lead_camp_type ON tracking_events(lead_id, campaign_id, event_type)`.catch(() => {});

    tablesInitialized = true;
    console.log("✅ Database tables initialized successfully");
  } catch (e) {
    console.error("❌ Database initialization failed:", e.message);
    throw e;
  }
}

// Simplified database operations
async function get(key) {
  try {
    await ensureTable();
    const sql = getDb();
    const rows = await sql`
      SELECT value FROM kv_store
      WHERE key = ${key}
        AND (expires_at IS NULL OR expires_at > ${Date.now()})
      LIMIT 1
    `;
    return rows[0]?.value ?? null;
  } catch (e) {
    console.error(`Get failed for key ${key}:`, e.message);
    return null;
  }
}

async function set(key, value, exSeconds = null) {
  try {
    await ensureTable();
    const sql = getDb();
    const expiresAt = exSeconds ? Date.now() + exSeconds * 1000 : null;
    await sql`
      INSERT INTO kv_store (key, value, expires_at)
      VALUES (${key}, ${String(value)}, ${expiresAt})
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
    `;
    return "OK";
  } catch (e) {
    console.error(`Set failed for key ${key}:`, e.message);
    throw e;
  }
}

// Simplified tracking increment
async function incr(key) {
  try {
    console.log(`🔍 [INCR] Starting increment for key: ${key}`);
    await ensureTable();
    const sql = getDb();
    
    // Handle tracking keys specially
    if (key.startsWith('track:open:') || key.startsWith('track:click:')) {
      const leadId = key.split(':')[2];
      const isOpen = key.startsWith('track:open:');
      
      console.log(`🔍 [INCR] Processing ${isOpen ? 'OPEN' : 'CLICK'} for lead: ${leadId}`);
      
      if (isOpen) {
        const rows = await sql`
          INSERT INTO simple_tracking (lead_id, opens, last_open)
          VALUES (${leadId}, 1, ${Date.now()})
          ON CONFLICT (lead_id) DO UPDATE
            SET opens = simple_tracking.opens + 1,
                last_open = ${Date.now()}
          RETURNING opens
        `;
        console.log(`✅ [INCR] Open count for ${leadId}: ${rows[0].opens}`);
        return parseInt(rows[0].opens);
      } else {
        const rows = await sql`
          INSERT INTO simple_tracking (lead_id, clicks, last_click)
          VALUES (${leadId}, 1, ${Date.now()})
          ON CONFLICT (lead_id) DO UPDATE
            SET clicks = simple_tracking.clicks + 1,
                last_click = ${Date.now()}
          RETURNING clicks
        `;
        console.log(`✅ [INCR] Click count for ${leadId}: ${rows[0].clicks}`);
        return parseInt(rows[0].clicks);
      }
    }
    
    // Fallback for other keys
    const rows = await sql`
      INSERT INTO kv_store (key, value, expires_at)
      VALUES (${key}, '1', NULL)
      ON CONFLICT (key) DO UPDATE
        SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT
      RETURNING value
    `;
    return parseInt(rows[0].value);
  } catch (e) {
    console.error(`❌ [INCR] Failed for key ${key}:`, e.message, e.stack);
    throw e;
  }
}

async function del(key) {
  try {
    await ensureTable();
    const sql = getDb();
    await sql`DELETE FROM kv_store WHERE key = ${key}`;
    return 1;
  } catch (e) {
    console.error(`Delete failed for key ${key}:`, e.message);
    return 0;
  }
}

async function hset(hash, field, value) {
  return set(`${hash}:${field}`, value);
}

async function hgetall(hash) {
  try {
    await ensureTable();
    const sql = getDb();
    const rows = await sql`
      SELECT key, value FROM kv_store
      WHERE key LIKE ${hash + ":%"}
        AND (expires_at IS NULL OR expires_at > ${Date.now()})
    `;
    const obj = {};
    const prefix = hash + ":";
    rows.forEach(r => { obj[r.key.slice(prefix.length)] = r.value; });
    return obj;
  } catch (e) {
    console.error(`Hgetall failed for hash ${hash}:`, e.message);
    return {};
  }
}

// Simplified event logging
async function logEvent({ lead_id, event_type, ip, user_agent, target_url = null, campaign_id = null }) {
  try {
    await ensureTable();
    const sql = getDb();

    // If INSERT fails due to a missing column, add all known optional columns
    // and retry. Handles tables created before target_url or campaign_id were added.
    try {
      await sql`
        INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, campaign_id, created_at)
        VALUES (${lead_id}, ${event_type}, ${ip}, ${user_agent}, ${target_url}, ${campaign_id}, ${Date.now()})
      `;
    } catch (insertErr) {
      const isMissingCol = insertErr.message && (
        insertErr.message.includes('column') || insertErr.message.includes('does not exist')
      );
      if (isMissingCol) {
        console.warn(`[EVENT LOG] Missing column detected, running migrations inline: ${insertErr.message}`);
        await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS campaign_id TEXT`.catch(() => {});
        await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS target_url TEXT`.catch(() => {});
        await sql`
          INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, campaign_id, created_at)
          VALUES (${lead_id}, ${event_type}, ${ip}, ${user_agent}, ${target_url}, ${campaign_id}, ${Date.now()})
        `;
      } else {
        throw insertErr;
      }
    }

    console.log(`✅ [EVENT LOGGED] ${event_type.toUpperCase()} lead:${lead_id} camp:${campaign_id||'—'}`);
  } catch (e) {
    console.error(`❌ [EVENT LOG FAILED] ${event_type} lead:${lead_id}:`, e.message);
  }
}

// Get tracking stats
async function getTrackingStats(leadIds) {
  try {
    await ensureTable();
    const sql = getDb();
    
    if (!leadIds || leadIds.length === 0) return {};
    
    const rows = await sql`
      SELECT lead_id, opens, clicks 
      FROM simple_tracking 
      WHERE lead_id = ANY(${leadIds})
    `;
    
    const stats = {};
    rows.forEach(row => {
      stats[row.lead_id] = {
        opens: parseInt(row.opens) || 0,
        clicks: parseInt(row.clicks) || 0
      };
    });
    
    // Fill in missing leads with zero counts
    leadIds.forEach(id => {
      if (!stats[id]) {
        stats[id] = { opens: 0, clicks: 0 };
      }
    });
    
    return stats;
  } catch (e) {
    console.error(`Get tracking stats failed:`, e.message);
    return {};
  }
}

// Get tracking events — optional campaignId narrows to that campaign only
async function getTrackingEvents(leadId, campaignId = null, limit = 100) {
  try {
    await ensureTable();
    const sql = getDb();
    const rows = campaignId
      ? await sql`
          SELECT event_type, ip, user_agent, target_url, campaign_id, created_at
          FROM tracking_events
          WHERE lead_id = ${leadId} AND campaign_id = ${campaignId}
          ORDER BY created_at DESC LIMIT ${limit}
        `
      : await sql`
          SELECT event_type, ip, user_agent, target_url, campaign_id, created_at
          FROM tracking_events
          WHERE lead_id = ${leadId}
          ORDER BY created_at DESC LIMIT ${limit}
        `;
    return rows;
  } catch (e) {
    console.error(`Get tracking events failed for lead ${leadId}:`, e.message);
    return [];
  }
}

// Known email security scanner IP ranges — always block regardless of timing
// Google Image Proxy: 66.249.x.x, 74.125.x.x, 64.233.x.x, 209.85.x.x, 216.58.x.x, 142.250.x.x
// Apple MPP: entire 17.0.0.0/8 block
// Microsoft SafeLinks (Azure): 40.94.x.x, 40.107.x.x, 52.100.x.x
function isScannerIp(ip) {
  if (!ip || ip === 'unknown') return false;
  return /^66\.249\./.test(ip)  || /^74\.125\./.test(ip)  ||
         /^64\.233\./.test(ip)  || /^209\.85\./.test(ip)  ||
         /^216\.58\./.test(ip)  || /^216\.239\./.test(ip) ||
         /^142\.250\./.test(ip) || /^108\.177\./.test(ip) ||
         /^17\./.test(ip)       ||                          // Apple
         /^40\.94\./.test(ip)   || /^40\.107\./.test(ip)  ||
         /^52\.100\./.test(ip);                             // Microsoft
}

// Deduplicated tracking for opens (only count unique opens within 1 hour window)
async function trackOpen(leadId, ip, userAgent, campaignId = null) {
  try {
    await ensureTable();
    const sql = getDb();

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // ── Timing guard — unknown IPs only ───────────────────────────────────────
    // Gmail delivers tracking pixels exclusively through Google Image Proxy
    // (66.249.x.x etc.). Google pre-fetches at delivery AND caches the image —
    // it does NOT re-fetch when the user actually opens the email. So the
    // pre-fetch IS the only open signal for Gmail users; blocking it means 0 opens.
    //
    // Strategy:
    //   Known email proxies (Google/Apple/Microsoft): skip timing guard entirely.
    //     Their pre-fetch counts as the open (industry standard — Mailchimp etc.).
    //     The 1-hour IP dedup below prevents double-counting.
    //   Unknown IPs: apply 15s guard to catch other scanner types.
    const isEmailProxy = isScannerIp(ip);
    if (!isEmailProxy) {
      const guardRaw = await sql`
        SELECT value FROM kv_store WHERE key = ${'email:guard:' + leadId}
          AND (expires_at IS NULL OR expires_at > ${now}) LIMIT 1
      `.catch(() => []);
      if (guardRaw.length > 0) {
        const sentAt = parseInt(guardRaw[0].value) || 0;
        if (now - sentAt < 15000) {
          console.log(`🛡️ [GUARD] Early open blocked for lead ${leadId} (${Math.round((now-sentAt)/1000)}s after send)`);
          return { counted: false, reason: 'scanner guard (15s)', count: 0 };
        }
      }
    }

    // Dedup: only block if same IP opened within the last 2 minutes
    // (prevents double-counting a single load that triggers multiple requests,
    // but allows the same person opening again later to count).
    const twoMinutesAgo = now - (2 * 60 * 1000);
    const existing = await sql`
      SELECT created_at FROM tracking_events
      WHERE lead_id = ${leadId}
        AND event_type = 'open'
        AND ip = ${ip}
        AND campaign_id = ${campaignId || null}
        AND created_at > ${twoMinutesAgo}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return { counted: false, reason: '2 min dedup', count: 0 };
    }

    // Count this open
    const rows = await sql`
      INSERT INTO simple_tracking (lead_id, opens, last_open)
      VALUES (${leadId}, 1, ${now})
      ON CONFLICT (lead_id) DO UPDATE
        SET opens = simple_tracking.opens + 1,
            last_open = ${now}
      RETURNING opens
    `;
    
    // Log the event
    await logEvent({
      lead_id: leadId,
      event_type: 'open',
      ip,
      user_agent: userAgent,
      campaign_id: campaignId || null,
      target_url: campaignId ? `campaign:${campaignId}` : null
    });
    
    const count = parseInt(rows[0].opens);
    console.log(`✅ [TRACK OPEN] Unique open counted for ${leadId}, total: ${count}`);
    
    return { counted: true, count };
  } catch (e) {
    console.error(`❌ [TRACK OPEN] Failed for ${leadId}:`, e.message);
    throw e;
  }
}

// Deduplicated tracking for clicks (only count unique clicks within 5 minute window)
async function trackClick(leadId, ip, userAgent, targetUrl, campaignId = null) {
  try {
    await ensureTable();
    const sql = getDb();

    // Block known scanner IPs (same as trackOpen)
    if (isScannerIp(ip)) {
      console.log(`🛡️ [GUARD] Known scanner IP blocked click for lead ${leadId}: ${ip}`);
      return { counted: false, reason: 'scanner IP', count: 0 };
    }

    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000); // 5 minute window

    // Check if this exact click was already tracked recently
    const existing = await sql`
      SELECT created_at FROM tracking_events
      WHERE lead_id = ${leadId}
        AND event_type = 'click'
        AND ip = ${ip}
        AND target_url = ${targetUrl}
        AND created_at > ${fiveMinutesAgo}
      LIMIT 1
    `;
    
    if (existing.length > 0) {
      // Duplicate within 5 minutes - don't count
      return { counted: false, reason: '5 minute window', count: 0 };
    }
    
    // This is a unique click - count it
    const rows = await sql`
      INSERT INTO simple_tracking (lead_id, clicks, last_click)
      VALUES (${leadId}, 1, ${now})
      ON CONFLICT (lead_id) DO UPDATE
        SET clicks = simple_tracking.clicks + 1,
            last_click = ${now}
      RETURNING clicks
    `;
    
    // Log the event
    await logEvent({
      lead_id: leadId,
      event_type: 'click',
      ip,
      user_agent: userAgent,
      campaign_id: campaignId || null,
      target_url: targetUrl
    });
    
    const count = parseInt(rows[0].clicks);
    console.log(`✅ [TRACK CLICK] Unique click counted for ${leadId}, total: ${count}`);
    
    return { counted: true, count };
  } catch (e) {
    console.error(`❌ [TRACK CLICK] Failed for ${leadId}:`, e.message);
    throw e;
  }
}

module.exports = { 
  get, set, incr, del, hset, hgetall, logEvent, getDb, 
  getTrackingStats, getTrackingEvents, withRetry, ensureTable,
  trackOpen, trackClick
};
