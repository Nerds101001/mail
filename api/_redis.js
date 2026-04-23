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
    
    // Create simple tracking table
    await sql`
      CREATE TABLE IF NOT EXISTS simple_tracking (
        lead_id TEXT PRIMARY KEY,
        opens INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        last_open BIGINT,
        last_click BIGINT
      )
    `;
    
    // Create basic kv store
    await sql`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at BIGINT DEFAULT NULL
      )
    `;
    
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
    await ensureTable();
    const sql = getDb();
    
    // Handle tracking keys specially
    if (key.startsWith('track:open:') || key.startsWith('track:click:')) {
      const leadId = key.split(':')[2];
      const isOpen = key.startsWith('track:open:');
      
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
    console.error(`Incr failed for key ${key}:`, e.message);
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
async function logEvent({ lead_id, event_type, ip, user_agent, target_url = null }) {
  try {
    await ensureTable();
    const sql = getDb();
    
    // Create events table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        lead_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        target_url TEXT,
        created_at BIGINT NOT NULL
      )
    `;
    
    await sql`
      INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, created_at)
      VALUES (${lead_id}, ${event_type}, ${ip}, ${user_agent}, ${target_url}, ${Date.now()})
    `;
    console.log(`✅ [EVENT LOGGED] ${event_type.toUpperCase()} for lead ${lead_id}`);
  } catch (e) {
    console.error(`❌ [EVENT LOG FAILED] ${event_type} for lead ${lead_id}:`, e.message);
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

// Get tracking events
async function getTrackingEvents(leadId, limit = 100) {
  try {
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
  } catch (e) {
    console.error(`Get tracking events failed for lead ${leadId}:`, e.message);
    return [];
  }
}

module.exports = { 
  get, set, incr, del, hset, hgetall, logEvent, getDb, 
  getTrackingStats, getTrackingEvents, withRetry, ensureTable 
};
