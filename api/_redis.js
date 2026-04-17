// api/_redis.js — Neon Postgres database helper with proper error handling
const { neon } = require("@neondatabase/serverless");

function getDb() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  return neon(url);
}

// Retry wrapper for database operations
async function withRetry(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (e) {
      console.error(`DB operation failed (attempt ${i + 1}/${maxRetries}):`, e.message);
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Table creation with proper error handling
let tableReadyPromise = null;
function ensureTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = withRetry(async () => {
      const sql = getDb();
      
      // Create tables with proper indexes
      await sql`
        CREATE TABLE IF NOT EXISTS kv_store (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          expires_at BIGINT DEFAULT NULL
        )
      `;
      
      await sql`
        CREATE TABLE IF NOT EXISTS tracking_events (
          id           SERIAL PRIMARY KEY,
          lead_id      TEXT NOT NULL,
          event_type   TEXT NOT NULL,
          ip           TEXT,
          user_agent   TEXT,
          target_url   TEXT,
          created_at   BIGINT NOT NULL
        )
      `;
      
      await sql`
        CREATE TABLE IF NOT EXISTS tracking_counters (
          lead_id     TEXT PRIMARY KEY,
          opens       INTEGER DEFAULT 0,
          clicks      INTEGER DEFAULT 0,
          updated_at  BIGINT DEFAULT 0
        )
      `;
      
      // Add indexes for better performance
      await sql`CREATE INDEX IF NOT EXISTS idx_tracking_events_lead_id ON tracking_events(lead_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_tracking_events_created_at ON tracking_events(created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL`;
      
      console.log("✅ Database tables initialized successfully");
    }).catch(e => { 
      tableReadyPromise = null; 
      console.error("❌ Database initialization failed:", e.message);
      throw e; 
    });
  }
  return tableReadyPromise;
}

async function get(key) {
  return withRetry(async () => {
    await ensureTable();
    const sql = getDb();
    const rows = await sql`
      SELECT value FROM kv_store
      WHERE key = ${key}
        AND (expires_at IS NULL OR expires_at > ${Date.now()})
      LIMIT 1
    `;
    return rows[0]?.value ?? null;
  });
}

async function set(key, value, exSeconds = null) {
  return withRetry(async () => {
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
  });
}

// Improved tracking counter increment with atomic operations
async function incr(key) {
  return withRetry(async () => {
    await ensureTable();
    const sql = getDb();
    
    // For tracking counters, use dedicated table for better performance
    if (key.startsWith('track:open:') || key.startsWith('track:click:')) {
      const leadId = key.split(':')[2];
      const field = key.startsWith('track:open:') ? 'opens' : 'clicks';
      
      const rows = await sql`
        INSERT INTO tracking_counters (lead_id, ${sql(field)}, updated_at)
        VALUES (${leadId}, 1, ${Date.now()})
        ON CONFLICT (lead_id) DO UPDATE
          SET ${sql(field)} = tracking_counters.${sql(field)} + 1,
              updated_at = ${Date.now()}
        RETURNING ${sql(field)}
      `;
      return parseInt(rows[0][field]);
    }
    
    // Fallback to kv_store for other counters
    const rows = await sql`
      INSERT INTO kv_store (key, value, expires_at)
      VALUES (${key}, '1', NULL)
      ON CONFLICT (key) DO UPDATE
        SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT
      RETURNING value
    `;
    return parseInt(rows[0].value);
  });
}

async function del(key) {
  return withRetry(async () => {
    await ensureTable();
    const sql = getDb();
    await sql`DELETE FROM kv_store WHERE key = ${key}`;
    return 1;
  });
}

async function hset(hash, field, value) {
  return set(`${hash}:${field}`, value);
}

async function hgetall(hash) {
  return withRetry(async () => {
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
  });
}

async function logEvent({ lead_id, event_type, ip, user_agent, target_url = null }) {
  return withRetry(async () => {
    await ensureTable();
    const sql = getDb();
    await sql`
      INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, created_at)
      VALUES (${lead_id}, ${event_type}, ${ip}, ${user_agent}, ${target_url}, ${Date.now()})
    `;
    console.log(`✅ [EVENT LOGGED] ${event_type.toUpperCase()} for lead ${lead_id}`);
  }, 2); // Only 2 retries for logging to avoid delays
}

// Get tracking stats for multiple leads efficiently
async function getTrackingStats(leadIds) {
  return withRetry(async () => {
    await ensureTable();
    const sql = getDb();
    
    if (!leadIds || leadIds.length === 0) return {};
    
    const rows = await sql`
      SELECT lead_id, opens, clicks 
      FROM tracking_counters 
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
  });
}

// Get tracking events for a specific lead
async function getTrackingEvents(leadId, limit = 100) {
  return withRetry(async () => {
    await ensureTable();
    const sql = getDb();
    
    const rows = await sql`
      SELECT event_type, ip, user_agent, target_url, created_at
      FROM tracking_events 
      WHERE lead_id = ${leadId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    
    return rows;
  });
}

module.exports = { 
  get, set, incr, del, hset, hgetall, logEvent, getDb, 
  getTrackingStats, getTrackingEvents, withRetry, ensureTable 
};
