// api/_redis.js — Postgres database helper (works with AWS RDS, Supabase, Neon, etc.)
const { getSql } = require("./_db");

// ── Device parser (no external library needed) ────────────────────────────────
function parseDevice(ua) {
  if (!ua || ua === 'unknown') return { type: 'Unknown', client: 'Unknown' };
  const type = /mobile|android|iphone|ipad/i.test(ua) ? 'Mobile'
             : /tablet/i.test(ua) ? 'Tablet' : 'Desktop';
  const client = /googleimageproxy|gmail\s*proxy/i.test(ua) ? 'Gmail Proxy'
               : /apple\s*mail|mail\/\d/i.test(ua) ? 'Apple Mail'
               : /outlook/i.test(ua) ? 'Outlook'
               : /thunderbird/i.test(ua) ? 'Thunderbird'
               : /yahoo/i.test(ua) ? 'Yahoo Mail'
               : /chrome/i.test(ua) ? 'Chrome'
               : /safari/i.test(ua) ? 'Safari'
               : /firefox/i.test(ua) ? 'Firefox'
               : 'Other';
  return { type, client };
}

// ── IP geolocation (geoip-lite — offline, no API key) ─────────────────────────
let _geoip = null;
function getGeo(ip) {
  try {
    if (!_geoip) _geoip = require('geoip-lite');
    if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip.startsWith('::')) return { country: '', city: '' };
    const g = _geoip.lookup(ip);
    return g ? { country: g.country || '', city: (g.city || '') } : { country: '', city: '' };
  } catch { return { country: '', city: '' }; }
}

function getDb() {
  return getSql();
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
    await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS device_type TEXT`.catch(() => {});
    await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS device_client TEXT`.catch(() => {});
    await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS country TEXT`.catch(() => {});
    await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS city TEXT`.catch(() => {});
    await sql`ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE`.catch(() => {});
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
          SELECT event_type, ip, user_agent, target_url, campaign_id, device_type, device_client, country, city, is_bot, created_at
          FROM tracking_events
          WHERE lead_id = ${leadId} AND campaign_id = ${campaignId}
          ORDER BY created_at DESC LIMIT ${limit}
        `
      : await sql`
          SELECT event_type, ip, user_agent, target_url, campaign_id, device_type, device_client, country, city, is_bot, created_at
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

// ── IP / UA classification ────────────────────────────────────────────────────
//
// THREE categories:
//
// 1. BOT IPs — fire automatically, NEVER count, log as is_bot=true
//    17.x.x.x        Apple MPP — pre-fetches ALL images on delivery, not on read
//    40.94/40.107    Microsoft SafeLinks scanner — scans every link automatically
//    52.100.x        Microsoft SafeLinks scanner
//    66.249.x        Google delivery scanner (also caught by timing guard)
//    104.47.x        Microsoft email scanner
//
// 2. MAIL PROXY IPs — real user opens routed through mail provider's proxy
//    74.125, 64.233, 209.85, 216.58, 216.239, 142.250, 108.177 — Gmail/Google proxy
//    These fire ONLY when a real user opens — bypass timing guard, count normally
//    (Geo will show Google datacenter, not user's real city — that's expected)
//
// 3. ALL OTHER IPs — real user opens from their own IP
//    Apply timing guard (blocks delivery scanners within 12s of send)

// Hard-blocked IPs — scanners that should NEVER be counted regardless of timing.
// Apple MPP and Microsoft SafeLinks fire automatically on delivery, not on user open.
// Google/Amazon infrastructure scanners are server-side crawlers, not real users.
function isBotIp(ip) {
  if (!ip || ip === 'unknown') return false;
  return /^17\./.test(ip)         ||   // Apple MPP — auto-prefetch on delivery
         /^40\.94\./.test(ip)     ||   // Microsoft SafeLinks
         /^40\.107\./.test(ip)    ||   // Microsoft SafeLinks
         /^52\.100\./.test(ip)    ||   // Microsoft SafeLinks
         /^104\.47\./.test(ip)    ||   // Microsoft email scanner
         /^172\.253\./.test(ip)   ||   // Google Safe Browsing / link scanner
         /^130\.211\./.test(ip)   ||   // Google Cloud scanner
         /^35\.190\./.test(ip)    ||   // Google Cloud scanner
         /^23\.21\./.test(ip)     ||   // Amazon SES content scanner
         /^54\.240\./.test(ip);        // Amazon SES scanner
  // NOTE: 66.249.x (Google delivery scanner) is NOT here — it fires at delivery
  // (caught by 5s guard → 204) AND at real user opens (counted after 5s guard).
  // Hard-blocking it would miss real opens from Google IPs.
}

// Gmail / Google proxy IPs — fire ONLY on real user opens (not delivery).
// These bypass the 5s timing guard entirely and are always counted.
// Strategy matches the working Vercel version: 66.249.x goes through the 5s guard
// (204 on delivery scan → Gmail re-requests on real open → 74.125.x fires → counted).
function isMailProxyIp(ip) {
  if (!ip || ip === 'unknown') return false;
  return /^74\.125\./.test(ip)  ||   // Gmail image proxy — real user opens only
         /^64\.233\./.test(ip)  ||
         /^209\.85\./.test(ip)  ||
         /^216\.58\./.test(ip)  ||
         /^216\.239\./.test(ip) ||
         /^142\.250\./.test(ip) ||
         /^108\.177\./.test(ip);
}

// User-agent based bot detection — catches corporate scanners by UA string
function isBotUA(ua) {
  if (!ua || ua === 'unknown') return false;
  return /proofpoint|barracuda|mimecast|symantec\.cloud|trend\s*micro|sophos|forcepoint|ironport|postmaster|previewer|prefetch|link.*checker|url.*checker|safety.*checker|zgrab|python-urllib|python-requests|java\/[0-9]|curl\/|wget\/|go-http-client|nessus|scanner/i.test(ua);
}

// Combined: is this request from a hard-blocked bot?
function isBot(ip, ua) {
  return isBotIp(ip) || isBotUA(ua);
}

// ── Auto pipeline stage advancement ──────────────────────────────────────────
// Called after a real open/click is counted. Reads the lead from kv_store and
// bumps its pipelineStage: CONTACTED→OPENED on 1st open, →HOT on 2+ opens or any click.
// Returns the new stage (or null if unchanged).
async function autoUpdateStage(leadId, campaignId, opens, isClick, sql) {
  try {
    if (!campaignId) return null;
    const camps = await sql`SELECT user_id FROM campaigns WHERE id = ${campaignId} LIMIT 1`.catch(() => []);
    if (!camps.length) return null;
    const userId  = camps[0].user_id || 'admin';
    const lKey    = userId === 'admin' ? 'crm:leads' : `crm:leads:${userId}`;
    const raw     = await sql`SELECT value FROM kv_store WHERE key = ${lKey} AND (expires_at IS NULL OR expires_at > ${Date.now()}) LIMIT 1`.catch(() => []);
    if (!raw.length || !raw[0].value) return null;

    const leads = JSON.parse(raw[0].value);
    const lead  = leads.find(l => l.id === leadId);
    if (!lead) return null;

    const cur = lead.pipelineStage || 'COLD';
    // Don't touch stages that are already further along
    if (['HOT','DEMO','QUOTED','WON','LOST','UNSUBSCRIBED'].includes(cur) && !isClick) return null;
    if (['WON','LOST','UNSUBSCRIBED'].includes(cur)) return null;

    let next = cur;
    if (isClick) {
      if (['COLD','CONTACTED','OPENED'].includes(cur)) next = 'HOT';
    } else {
      if (cur === 'CONTACTED' || cur === 'COLD') next = 'OPENED';
      if (opens >= 2 && ['CONTACTED','OPENED','COLD'].includes(cur)) next = 'HOT';
    }
    if (next === cur) return null;

    const updated = leads.map(l => l.id === leadId ? { ...l, pipelineStage: next } : l);
    await sql`UPDATE kv_store SET value = ${JSON.stringify(updated)} WHERE key = ${lKey}`.catch(() => {});
    console.log(`🔄 [AUTO-STAGE] ${leadId}: ${cur} → ${next}`);

    // ── Auto follow-up task when lead goes HOT ───────────────────────────
    if (next === 'HOT') {
      try {
        const tKey    = userId === 'admin' ? 'crm:activity' : `crm:activity:${userId}`;
        const actRaw  = await sql`SELECT value FROM kv_store WHERE key = ${tKey} AND (expires_at IS NULL OR expires_at > ${Date.now()}) LIMIT 1`.catch(() => []);
        const activity = actRaw.length ? JSON.parse(actRaw[0].value) : [];
        const name     = lead.name || lead.email || leadId;
        const company  = lead.company ? ` (${lead.company})` : '';
        const trigger  = isClick ? 'clicked a link' : `opened ${opens}x`;
        // Only create if no existing open follow-up task for this lead
        const exists = activity.some(a => a.type === 'follow-up' && a.leadId === leadId && !a.done);
        if (!exists) {
          activity.unshift({
            id: `task_${Date.now()}_${leadId.slice(-4)}`,
            type: 'follow-up',
            leadId,
            title: `Follow up with ${name}${company}`,
            detail: `Lead went HOT — ${trigger}. High buying intent.`,
            priority: 'HIGH',
            dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            done: false,
            createdAt: Date.now(),
            autoCreated: true,
          });
          await sql`UPDATE kv_store SET value = ${JSON.stringify(activity)} WHERE key = ${tKey}`.catch(async () => {
            await sql`INSERT INTO kv_store (key, value, expires_at) VALUES (${tKey}, ${JSON.stringify(activity)}, NULL) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`.catch(() => {});
          });
          console.log(`📋 [AUTO-TASK] Created follow-up task for HOT lead ${leadId}`);
        }
      } catch (e) { console.error('[AUTO-TASK] Error:', e.message); }
    }

    return next;
  } catch (e) {
    console.error('[AUTO-STAGE] Error:', e.message);
    return null;
  }
}

// ── SSE emit helper (non-blocking — fails silently if no clients connected) ───
function sseEmit(event, data) {
  try { require('./sse').emit(event, data); } catch {}
}

// Deduplicated tracking for opens (only count unique opens within 1 hour window)
async function trackOpen(leadId, ip, userAgent, campaignId = null) {
  try {
    await ensureTable();
    const sql = getDb();

    const now = Date.now();

    const device = parseDevice(userAgent);
    const geo    = getGeo(ip);

    // ── Step 1: Hard-block known bots/proxies ────────────────────────────────
    // Apple MPP (17.x), Microsoft SafeLinks (40.94/40.107/52.100),
    // Google delivery scanner (66.249.x), corporate scanner UAs.
    // Log these so they're visible in UI (greyed out) but NEVER count or stage-advance.
    if (isBot(ip, userAgent)) {
      const botReason = isBotIp(ip)
        ? (/^17\./.test(ip)       ? 'Apple MPP'
         : /^66\.249\./.test(ip)  ? 'Google Scanner'
         : /^66\.102\./.test(ip)  ? 'Google Scanner'
         : /^172\.253\./.test(ip) ? 'Google SafeBrowse'
         : /^130\.211\./.test(ip) ? 'Google Cloud Scanner'
         : /^35\.190\./.test(ip)  ? 'Google Cloud Scanner'
         : /^23\.21\./.test(ip)   ? 'Amazon SES Scanner'
         : /^54\.240\./.test(ip)  ? 'Amazon SES Scanner'
         : 'Microsoft Scanner')
        : 'Bot UA';
      console.log(`🤖 [BOT-BLOCK] ${botReason} blocked for lead ${leadId} IP:${ip}`);
      try {
        await sql`
          INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, campaign_id, device_type, device_client, country, city, is_bot, created_at)
          VALUES (${leadId}, 'open', ${ip}, ${userAgent}, ${campaignId ? `campaign:${campaignId}` : null}, ${campaignId || null},
                  ${device.type}, ${device.client}, ${geo.country || null}, ${geo.city || null}, ${true}, ${now})
        `;
      } catch {}
      return { counted: false, reason: botReason, count: 0 };
    }

    // ── Step 2: Attachment scanner guard — extra window after sends with files ─
    // Gmail's attachment content scanner can fire from Gmail proxy IPs too.
    // Block ANY IP within 10s of an attachment send.
    const attGuardRaw = await sql`
      SELECT value FROM kv_store WHERE key = ${'email:att-guard:' + leadId}
        AND (expires_at IS NULL OR expires_at > ${now}) LIMIT 1
    `.catch(() => []);
    if (attGuardRaw.length > 0) {
      const sentAt = parseInt(attGuardRaw[0].value) || 0;
      if (now - sentAt < 10000) {
        console.log(`🛡️ [ATT-GUARD] Attachment scanner blocked for lead ${leadId} IP:${ip} (${Math.round((now-sentAt)/1000)}s after send)`);
        return { counted: false, reason: 'attachment scanner guard (10s)', count: 0 };
      }
    }

    // ── Step 3: Timing guard — 5s for non-Gmail-proxy IPs ───────────────────
    // Matches the working Vercel strategy exactly:
    //   • Gmail proxy (74.125.x etc.) → bypass guard → always counted
    //     These only fire on real user opens, never at delivery.
    //   • 66.249.x (Google delivery scanner) → goes through 5s guard
    //     Within 5s → NOT counted → 204 returned → Gmail has nothing cached
    //     → Gmail proxy (74.125.x) re-requests on real open → counted correctly
    //   • All other unknown IPs → 5s guard catches delivery scanners
    if (!isMailProxyIp(ip)) {
      const guardRaw = await sql`
        SELECT value FROM kv_store WHERE key = ${'email:guard:' + leadId}
          AND (expires_at IS NULL OR expires_at > ${now}) LIMIT 1
      `.catch(() => []);
      if (guardRaw.length > 0) {
        const sentAt = parseInt(guardRaw[0].value) || 0;
        const elapsed = now - sentAt;
        if (elapsed < 5000) {
          console.log(`🛡️ [GUARD] Early open blocked for lead ${leadId} IP:${ip} (${Math.round(elapsed/1000)}s after send, guard=5s)`);
          return { counted: false, reason: 'scanner guard (5s)', count: 0 };
        }
      }
    }

    // ── Step 4: 30s dedup — same IP can't double-count within 30s ────────────
    const thirtySecondsAgo = now - (30 * 1000);
    const existing = await sql`
      SELECT created_at FROM tracking_events
      WHERE lead_id = ${leadId}
        AND event_type = 'open'
        AND ip = ${ip}
        AND campaign_id = ${campaignId || null}
        AND created_at > ${thirtySecondsAgo}
      LIMIT 1
    `;
    if (existing.length > 0) {
      return { counted: false, reason: '30s dedup', count: 0 };
    }

    // ── Step 5: Count the real open ───────────────────────────────────────────
    const rows = await sql`
      INSERT INTO simple_tracking (lead_id, opens, last_open)
      VALUES (${leadId}, 1, ${now})
      ON CONFLICT (lead_id) DO UPDATE
        SET opens = simple_tracking.opens + 1,
            last_open = ${now}
      RETURNING opens
    `;
    const count = parseInt(rows[0].opens);

    // Log event
    try {
      await sql`
        INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, campaign_id, device_type, device_client, country, city, is_bot, created_at)
        VALUES (${leadId}, 'open', ${ip}, ${userAgent}, ${campaignId ? `campaign:${campaignId}` : null}, ${campaignId || null},
                ${device.type}, ${device.client}, ${geo.country || null}, ${geo.city || null}, ${false}, ${now})
      `;
      console.log(`✅ [EVENT LOGGED] OPEN lead:${leadId} camp:${campaignId || '—'} device:${device.type}/${device.client} geo:${geo.country||'?'}/${geo.city||'?'}`);
    } catch (e) {
      console.error(`❌ [EVENT LOG FAILED] open lead:${leadId}:`, e.message);
    }

    // Auto-advance pipeline stage (only on real opens)
    const newStage = await autoUpdateStage(leadId, campaignId, count, false, sql).catch(() => null);

    // Real-time SSE notification to all connected CRM browsers
    sseEmit('open_event', { leadId, opens: count, newStage, device, geo, campaignId, ts: now });

    console.log(`✅ [TRACK OPEN] Real open counted for ${leadId}, total: ${count}`);
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

    const now = Date.now();
    const device = parseDevice(userAgent);
    const geo    = getGeo(ip);

    // ── Block known bots / scanners ───────────────────────────────────────────
    // Microsoft SafeLinks, Google SafeBrowsing, Apple MPP — all scan links.
    // Log but never count or advance stage.
    if (isBot(ip, userAgent)) {
      const botReason = isBotIp(ip)
        ? (/^40\./.test(ip) || /^104\.47\./.test(ip) ? 'Microsoft SafeLinks'
         : /^172\.253\./.test(ip) ? 'Google SafeBrowse'
         : /^17\./.test(ip) ? 'Apple MPP'
         : 'Bot Scanner')
        : 'Bot UA';
      console.log(`🤖 [BOT-CLICK] ${botReason} blocked for lead ${leadId} IP:${ip}`);
      try {
        await sql`
          INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, campaign_id, device_type, device_client, country, city, is_bot, created_at)
          VALUES (${leadId}, 'click', ${ip}, ${userAgent}, ${targetUrl}, ${campaignId || null},
                  ${device.type}, ${device.client}, ${geo.country || null}, ${geo.city || null}, ${true}, ${now})
        `;
      } catch {}
      return { counted: false, reason: botReason, count: 0 };
    }

    // ── 5-minute dedup — same IP + URL ───────────────────────────────────────
    const fiveMinutesAgo = now - (5 * 60 * 1000);
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
      return { counted: false, reason: '5 minute window', count: 0 };
    }

    // ── Count the real click ──────────────────────────────────────────────────
    const rows = await sql`
      INSERT INTO simple_tracking (lead_id, clicks, last_click)
      VALUES (${leadId}, 1, ${now})
      ON CONFLICT (lead_id) DO UPDATE
        SET clicks = simple_tracking.clicks + 1,
            last_click = ${now}
      RETURNING clicks
    `;
    const count = parseInt(rows[0].clicks);

    try {
      await sql`
        INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, target_url, campaign_id, device_type, device_client, country, city, is_bot, created_at)
        VALUES (${leadId}, 'click', ${ip}, ${userAgent}, ${targetUrl}, ${campaignId || null},
                ${device.type}, ${device.client}, ${geo.country || null}, ${geo.city || null}, ${false}, ${now})
      `;
      console.log(`✅ [EVENT LOGGED] CLICK lead:${leadId} camp:${campaignId || '—'} device:${device.type}/${device.client}`);
    } catch (e) {
      console.error(`❌ [EVENT LOG FAILED] click lead:${leadId}:`, e.message);
    }

    // Real click = high intent → auto-advance to HOT
    const newStage = await autoUpdateStage(leadId, campaignId, 0, true, sql).catch(() => null);

    // Real-time SSE notification
    sseEmit('click_event', { leadId, clicks: count, newStage, device, geo, targetUrl, campaignId, ts: now });

    console.log(`✅ [TRACK CLICK] Real click counted for ${leadId}, total: ${count}`);
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
