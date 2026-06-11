// api/crm.js — Unified CRM data + Campaign history
// All data is namespaced by userId so each user sees only their own data
// Admin (userId=admin) can see all users' data

const { get, set } = require("./_redis");
const { getSql } = require("./_db");

// ── Helpers ───────────────────────────────────────────────────────────────────
async function safeGet(key, fallback) {
  try { const v = await get(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
async function safeSet(key, value) {
  try { await set(key, JSON.stringify(value)); } catch(e) {} 
}

function sanitizeProfiles(profiles) {
  if (!Array.isArray(profiles)) return profiles;
  return profiles.map(p => {
    if (p.type === "smtp") { const { pass, ...safe } = p; return { ...safe, hasPass: !!pass }; }
    return p;
  });
}

// Get userId from token (quick lookup)
async function getUserIdFromToken(token) {
  if (!token) return "admin";
  if (/^sess_\d+_[a-z0-9]+$/.test(token) && token.length < 40) return "admin";
  try {
    const sql = getSql();
    const rows = await sql`SELECT user_id FROM sessions WHERE token = ${token} AND expires_at > ${Date.now()} LIMIT 1`;
    return rows[0]?.user_id || "admin";
  } catch { return "admin"; }
}

// Namespace key by user
function ns(key, userId) {
  if (!userId || userId === "admin") return key;
  return `${key}:${userId}`;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  const { type, id } = req.query;

  // ── TEMP DIAGNOSTIC — remove after investigation ──────────────────────
  if (type === "diag" && req.query.key === "diag_check_2024") {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) return res.json({ ok: false, error: "No DATABASE_URL or POSTGRES_URL set", env_keys: Object.keys(process.env).filter(k => k.includes("DATABASE") || k.includes("POSTGRES") || k.includes("NEON")) });
    try {
      const sqlD = getSql();
      const tables = await sqlD`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
      const kvCount = await sqlD`SELECT COUNT(*) as cnt FROM kv_store`.catch(() => [{ cnt: "TABLE_MISSING" }]);
      const kvKeys = await sqlD`SELECT key, LENGTH(value) as bytes FROM kv_store ORDER BY key LIMIT 100`.catch(() => []);
      const activeSessions = await sqlD`SELECT COUNT(*) as cnt FROM sessions WHERE expires_at > ${Date.now()}`.catch(() => [{ cnt: "TABLE_MISSING" }]);
      const campaignCount = await sqlD`SELECT COUNT(*) as cnt FROM campaign_leads`.catch(() => [{ cnt: "TABLE_MISSING" }]);
      return res.json({
        ok: true,
        db_url_host: dbUrl.match(/@([^/]+)\//)?.[1] || "unknown",
        tables: tables.map(t => t.tablename),
        kv_total_rows: kvCount[0]?.cnt,
        kv_keys: kvKeys.map(r => ({ key: r.key, bytes: r.bytes })),
        active_sessions: activeSessions[0]?.cnt,
        campaign_leads_total: campaignCount[0]?.cnt,
        ts: new Date().toISOString()
      });
    } catch(e) { return res.json({ ok: false, error: e.message }); }
  }
  // ── END TEMP DIAGNOSTIC ───────────────────────────────────────────────

  // Get userId from Authorization header or query param
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
  let userId = await getUserIdFromToken(token);

  // Admin can view any user's data by passing ?viewAs=userId
  if (userId === "admin" && req.query.viewAs && req.query.viewAs !== "admin") {
    userId = req.query.viewAs;
  }

  // ── LOAD ALL ─────────────────────────────────────────────────────────
  if (type === "load" && req.method === "GET") {
    const [leadsRaw, settings, activity, clients, deals, apikey] = await Promise.all([
      safeGet(ns("crm:leads", userId), []),
      safeGet("crm:settings", {}),           // settings are global
      safeGet(ns("crm:activity", userId), []),
      safeGet(ns("crm:clients", userId), []),
      safeGet(ns("crm:deals", userId), []),
      safeGet("crm:apikey", null),
    ]);
    // Profiles are per-user (each user has their own email credentials)
    const profiles = await safeGet(ns("crm:profiles", userId), []);
    const mergedSettings = apikey ? { ...settings, openaiKey: apikey } : settings;

    // ── Auto-sync pipeline stages from tracking data ───────────────────
    // Reads opens/clicks from simple_tracking and upgrades stages:
    //   COLD → CONTACTED (done client-side on send)
    //   CONTACTED → OPENED  (first open recorded)
    //   OPENED/CONTACTED → HOT (2+ opens OR 1+ clicks)
    // Never downgrades — terminal stages (WON/LOST/DEMO/QUOTED/UNSUBSCRIBED) are never touched.
    let leads = leadsRaw;
    try {
      const sql = getSql();
      const tracking = await sql`SELECT lead_id, opens, clicks FROM simple_tracking WHERE opens > 0 OR clicks > 0`;
      if (tracking.length > 0) {
        const STAGE_ORDER = { COLD:0, CONTACTED:1, OPENED:2, HOT:3 };
        const TERMINAL = new Set(['WON','LOST','UNSUBSCRIBED','DEMO','QUOTED','REPLIED']);
        const trackMap = {};
        tracking.forEach(t => { trackMap[t.lead_id] = { opens: parseInt(t.opens)||0, clicks: parseInt(t.clicks)||0 }; });

        let changed = 0;
        leads = leadsRaw.map(l => {
          const t = trackMap[l.id];
          if (!t) return l;
          const cur = l.pipelineStage || 'COLD';
          if (TERMINAL.has(cur)) return l; // never touch terminal stages

          // Determine what stage tracking data implies
          let implied;
          if (t.opens >= 2 || t.clicks >= 1) implied = 'HOT';
          else if (t.opens === 1) implied = 'OPENED';
          else return l;

          // Only upgrade, never downgrade
          if ((STAGE_ORDER[implied] || 0) > (STAGE_ORDER[cur] || 0)) {
            changed++;
            return { ...l, pipelineStage: implied };
          }
          return l;
        });
        if (changed > 0) console.log(`✅ [CRM LOAD] Auto-upgraded ${changed} lead pipeline stages from tracking`);
      }
    } catch(e) {
      console.warn('⚠ [CRM LOAD] Pipeline sync skipped:', e.message);
      leads = leadsRaw; // fallback to raw if tracking query fails
    }

    // ── Data cleanup (name + company) ────────────────────────────────────
    // Fixes leads stored before the enrichLead guards were added.
    // Runs on every load but only writes back when something is actually dirty.
    const BLANK_NAMES = new Set([
      'na','n/a','n.a','n.a.','none','null','nil','unknown',
      '-','--','---','?','name','no name','noname','test','n a'
    ]);
    // Free email provider domain prefixes whose name was auto-uppercased into company
    const FREE_PREFIXES = new Set([
      'gmail','yahoo','outlook','hotmail','icloud','aol','live',
      'protonmail','proton','zoho','ymail','rediffmail','mail',
      'gmx','tutanota','fastmail'
    ]);
    const FREE_DOMAINS_SET = new Set([
      'gmail.com','yahoo.com','yahoo.in','yahoo.co.in','outlook.com','hotmail.com',
      'icloud.com','aol.com','live.com','protonmail.com','proton.me','zoho.com',
      'ymail.com','rediffmail.com','mail.com','gmx.com','tutanota.com','fastmail.com'
    ]);

    let leadsDirty = false;
    leads = leads.map(l => {
      let { name = '', company = '', email = '' } = l;
      let changed = false;

      // Fix name: clear any placeholder value
      const trimName = name.trim();
      if (trimName && (BLANK_NAMES.has(trimName.toLowerCase()) || trimName.length < 2)) {
        name = ''; changed = true;
      }

      // Fix company: clear if it's just the domain prefix of a free email provider
      if (company && email) {
        const domain = (email.toLowerCase().split('@')[1] || '').trim();
        const compLower = company.trim().toLowerCase();
        if (FREE_DOMAINS_SET.has(domain) && FREE_PREFIXES.has(compLower)) {
          company = ''; changed = true;
        }
      }

      if (changed) { leadsDirty = true; return { ...l, name, company }; }
      return l;
    });

    if (leadsDirty) {
      await safeSet(ns("crm:leads", userId), leads);
      console.log(`✅ [CRM LOAD] Cleaned bad names/companies for user ${userId}`);
    }

    return res.json({ leads, profiles, settings: mergedSettings, activity, clients, deals });
  }

  // ── LEADS BY IDs (used by campaignRunner resume to re-hydrate compact checkpoints) ──
  if (type === "leads_by_ids" && req.method === "GET") {
    const idList = (req.query.ids || "").split(",").filter(Boolean);
    if (!idList.length) return res.json([]);
    const idSet = new Set(idList);
    const allLeads = await safeGet(ns("crm:leads", userId), []);
    return res.json(allLeads.filter(l => idSet.has(String(l.id))));
  }

  // ── SAVE ALL ─────────────────────────────────────────────────────────
  if (type === "save" && req.method === "POST") {
    const { leads, profiles, settings, activity, clients, deals } = req.body;

    // ── AUDIT LOGGING — track every save to catch silent overwrites ──────
    if (leads !== undefined) {
      try {
        const prevLeads = await safeGet(ns("crm:leads", userId), []);
        const prevCount = Array.isArray(prevLeads) ? prevLeads.length : 0;
        const newCount  = Array.isArray(leads) ? leads.length : 0;
        const ip        = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        const ua        = (req.headers['user-agent'] || '').substring(0, 80);
        const diff      = newCount - prevCount;
        const diffStr   = diff >= 0 ? `+${diff}` : `${diff}`;
        const level     = Math.abs(diff) > 50 ? '⚠️ LARGE CHANGE' : 'ℹ️';
        console.log(`${level} [LEADS SAVE] user=${userId} ip=${ip} prev=${prevCount} new=${newCount} diff=${diffStr} ua="${ua}"`);

        // Persist audit record to database for long-term investigation
        try {
          const sql = getSql();
          await sql`CREATE TABLE IF NOT EXISTS lead_save_audit (
            id SERIAL PRIMARY KEY,
            user_id TEXT,
            prev_count INT,
            new_count INT,
            diff INT,
            ip TEXT,
            user_agent TEXT,
            saved_at BIGINT
          )`.catch(()=>{});
          await sql`INSERT INTO lead_save_audit (user_id, prev_count, new_count, diff, ip, user_agent, saved_at)
            VALUES (${userId}, ${prevCount}, ${newCount}, ${diff}, ${ip}, ${ua}, ${Date.now()})`.catch(()=>{});
          // Keep only last 500 audit rows to avoid unbounded growth
          await sql`DELETE FROM lead_save_audit WHERE id NOT IN (SELECT id FROM lead_save_audit ORDER BY saved_at DESC LIMIT 500)`.catch(()=>{});
        } catch(_e) { /* audit DB write is non-blocking */ }
      } catch(_e) { /* audit is non-blocking */ }
    }
    // ── END AUDIT LOGGING ────────────────────────────────────────────────

    await Promise.all([
      leads    !== undefined ? safeSet(ns("crm:leads",    userId), leads) : null,
      profiles !== undefined ? safeSet(ns("crm:profiles", userId), sanitizeProfiles(profiles)) : null, // per-user
      settings !== undefined ? safeSet("crm:settings", (({openaiKey,...s})=>s)(settings||{})) : null,
      settings?.openaiKey    ? safeSet("crm:apikey", settings.openaiKey) : null,
      activity !== undefined ? safeSet(ns("crm:activity", userId), activity) : null,
      clients  !== undefined ? safeSet(ns("crm:clients",  userId), clients) : null,
      deals    !== undefined ? safeSet(ns("crm:deals",    userId), deals) : null,
    ].filter(Boolean));
    return res.json({ success: true });
  }

  // ── CLIENTS ───────────────────────────────────────────────────────────
  if (type === "clients") {
    const key = ns("crm:clients", userId);
    const clients = await safeGet(key, []);
    if (req.method === "GET") return res.json(clients);
    if (req.method === "POST") {
      const client = { id:"client_"+Date.now(), createdAt:new Date().toISOString(), paymentStatus:"PENDING", renewalStatus:"ACTIVE", ...req.body };
      clients.push(client); await safeSet(key, clients);
      return res.json({ ok:true, client });
    }
    if (req.method === "PUT") {
      const idx = clients.findIndex(c=>c.id===id);
      if (idx===-1) return res.status(404).json({error:"Not found"});
      clients[idx]={...clients[idx],...req.body,id}; await safeSet(key, clients);
      return res.json({ok:true,client:clients[idx]});
    }
    if (req.method === "DELETE") {
      await safeSet(key, clients.filter(c=>c.id!==id));
      return res.json({ok:true});
    }
  }

  // ── DEALS ─────────────────────────────────────────────────────────────
  if (type === "deals") {
    const key = ns("crm:deals", userId);
    const deals = await safeGet(key, []);
    if (req.method === "GET") return res.json(deals);
    if (req.method === "POST") {
      const deal = { id:"deal_"+Date.now(), createdAt:new Date().toISOString(), status:"OPEN", type:"QUOTATION", ...req.body };
      deals.push(deal); await safeSet(key, deals);
      return res.json({ok:true,deal});
    }
    if (req.method === "PUT") {
      const idx = deals.findIndex(d=>d.id===id);
      if (idx===-1) return res.status(404).json({error:"Not found"});
      deals[idx]={...deals[idx],...req.body,id}; await safeSet(key, deals);
      return res.json({ok:true,deal:deals[idx]});
    }
    if (req.method === "DELETE") {
      await safeSet(key, deals.filter(d=>d.id!==id));
      return res.json({ok:true});
    }
  }

  // ── CAMPAIGNS (history) ───────────────────────────────────────────────
  if (type === "campaigns") {
    try {
      const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
      const sql = getSql();

      await sql`CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at BIGINT, target TEXT, sender TEXT, total_sent INT DEFAULT 0, total_failed INT DEFAULT 0, total_skipped INT DEFAULT 0, stats JSONB DEFAULT '{}', brief JSONB DEFAULT '{}', variants JSONB DEFAULT '[]')`;
      await sql`CREATE TABLE IF NOT EXISTS campaign_leads (id SERIAL PRIMARY KEY, campaign_id TEXT, user_id TEXT, lead_id TEXT, lead_name TEXT, lead_email TEXT, lead_company TEXT, status TEXT DEFAULT 'sent', subject TEXT, body TEXT, sent_at BIGINT, opens INT DEFAULT 0, clicks INT DEFAULT 0, last_open BIGINT, last_click BIGINT, variant_index INT DEFAULT 0)`;
      // Ensure columns exist on existing tables
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS brief JSONB DEFAULT '{}'`.catch(()=>{});
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'`.catch(()=>{});
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'COMPLETED'`.catch(()=>{});
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at BIGINT`.catch(()=>{});
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '{}'`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS subject TEXT`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS body TEXT`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS opens INT DEFAULT 0`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS clicks INT DEFAULT 0`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS last_open BIGINT`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS last_click BIGINT`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS variant_index INT DEFAULT 0`.catch(()=>{});

      if (req.method === "GET" && id) {
        const [camp] = await sql`SELECT * FROM campaigns WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`;
        if (!camp) return res.status(404).json({error:"Not found"});

        // pending=true → return only PENDING leads (used by campaignRunner.resume)
        if (req.query.pending === "true") {
          const pendingLeads = await sql`
            SELECT lead_id, lead_name, lead_email, lead_company
            FROM campaign_leads
            WHERE campaign_id=${id} AND status='PENDING'
            ORDER BY id ASC
          `;
          return res.json({ pending_leads: pendingLeads });
        }

        // all_lead_ids=true → return every lead_id already in this campaign (any status)
        // Used by "Requeue unsent leads" to figure out which leads were never queued
        if (req.query.all_lead_ids === "true") {
          const rows = await sql`SELECT lead_id FROM campaign_leads WHERE campaign_id=${id}`;
          return res.json({ lead_ids: rows.map(r => String(r.lead_id)) });
        }

        const leads = await sql`SELECT * FROM campaign_leads WHERE campaign_id=${id} ORDER BY CASE WHEN status='PENDING' THEN 1 ELSE 0 END, sent_at DESC`;
        return res.json({
          ...camp,
          stats:           typeof camp.stats           === 'string' ? JSON.parse(camp.stats           ||"{}") : (camp.stats           || {}),
          brief:           typeof camp.brief           === 'string' ? JSON.parse(camp.brief           ||"{}") : (camp.brief           || {}),
          variants:        typeof camp.variants        === 'string' ? JSON.parse(camp.variants        ||"[]") : (camp.variants        || []),
          schedule_config: typeof camp.schedule_config === 'string' ? JSON.parse(camp.schedule_config ||"{}") : (camp.schedule_config || {}),
          leads,
        });
      }

      if (req.method === "GET") {
        const camps = userId === "admin"
          ? await sql`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`
          : await sql`SELECT * FROM campaigns WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 100`;
        return res.json(camps.map(c=>({
          ...c,
          stats:           typeof c.stats           === 'string' ? JSON.parse(c.stats           ||"{}") : (c.stats           || {}),
          brief:           typeof c.brief           === 'string' ? JSON.parse(c.brief           ||"{}") : (c.brief           || {}),
          variants:        typeof c.variants        === 'string' ? JSON.parse(c.variants        ||"[]") : (c.variants        || []),
          schedule_config: typeof c.schedule_config === 'string' ? JSON.parse(c.schedule_config ||"{}") : (c.schedule_config || {}),
        })));
      }

      if (req.method === "DELETE" && id) {
        await sql`DELETE FROM campaign_leads WHERE campaign_id=${id}`;
        await sql`DELETE FROM campaigns WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`;
        return res.json({ ok: true });
      }

      // PATCH — update a campaign (time, name, variants, config, status, stats)
      if (req.method === "PATCH" && id) {
        const { name, scheduled_at, schedule_config, variants, status: newStatus,
                total_sent, total_failed, total_skipped, update_lead } = req.body;

        // update_lead: update a single campaign_lead row PENDING → final status
        // AND atomically increment the campaign's running totals.
        // Called by campaignRunner after each individual send so stats are live.
        if (update_lead) {
          const { leadId, status: ls, subject, body, sentAt, variantIndex } = update_lead;
          const finalStatus = ls || 'SENT';

          // Update the individual lead row
          await sql`
            UPDATE campaign_leads
            SET status        = ${finalStatus},
                subject       = ${subject   || ''},
                body          = ${body      || ''},
                sent_at       = ${sentAt    || Date.now()},
                variant_index = ${variantIndex || 0}
            WHERE campaign_id = ${id}
              AND lead_id     = ${leadId}
              AND status      = 'PENDING'
          `;

          // Atomically increment campaign-level counters so history shows live stats
          if (finalStatus === 'SENT') {
            await sql`UPDATE campaigns SET total_sent    = COALESCE(total_sent,0)    + 1 WHERE id = ${id}`.catch(()=>{});
          } else if (finalStatus === 'FAILED' || finalStatus === 'BOUNCED') {
            await sql`UPDATE campaigns SET total_failed  = COALESCE(total_failed,0)  + 1 WHERE id = ${id}`.catch(()=>{});
          } else if (finalStatus === 'SKIPPED') {
            await sql`UPDATE campaigns SET total_skipped = COALESCE(total_skipped,0) + 1 WHERE id = ${id}`.catch(()=>{});
          }

          return res.json({ ok: true });
        }

        await sql`
          UPDATE campaigns SET
            name            = COALESCE(${name          ?? null}, name),
            scheduled_at    = COALESCE(${scheduled_at  ?? null}, scheduled_at),
            schedule_config = COALESCE(${schedule_config ? JSON.stringify(schedule_config) : null}::jsonb, schedule_config),
            variants        = COALESCE(${variants        ? JSON.stringify(variants)        : null}::jsonb, variants),
            status          = COALESCE(${newStatus      ?? null}, status),
            total_sent      = COALESCE(${total_sent     ?? null}, total_sent),
            total_failed    = COALESCE(${total_failed   ?? null}, total_failed),
            total_skipped   = COALESCE(${total_skipped  ?? null}, total_skipped)
          WHERE id = ${id} AND (user_id = ${userId} OR ${userId} = 'admin')
        `;
        return res.json({ ok: true });
      }

      if (req.method === "POST") {
        const { id: providedId, name, target, sender, leads: campLeads, stats, brief, variants,
                status, scheduled_at, schedule_config, leads_only } = req.body;
        const campId = providedId || `camp_${Date.now()}`;

        // leads_only=true — insert/update leads in an existing campaign, don't touch campaign row
        if (leads_only && providedId && campLeads?.length) {
          // Parallel inserts (much faster than sequential for large PENDING pre-inserts)
          await Promise.all(campLeads.map(l =>
            sql`
              INSERT INTO campaign_leads (campaign_id,user_id,lead_id,lead_name,lead_email,lead_company,status,subject,body,sent_at,variant_index)
              VALUES (${campId},${userId},${l.id},${l.name||""},${l.email||""},${l.company||""},${l.status||"PENDING"},${l.subject||""},${l.body||""},${l.sentAt||null},${l.variantIndex||0})
            `.catch(()=>{})
          ));
          return res.json({ ok: true, id: campId });
        }

        const campStatus = status || 'COMPLETED';
        await sql`
          INSERT INTO campaigns (id,user_id,name,created_at,target,sender,total_sent,total_failed,total_skipped,stats,brief,variants,status,scheduled_at,schedule_config)
          VALUES (${campId},${userId},${name||"Campaign"},${Date.now()},${target||"all"},${sender||""},${stats?.sent||0},${stats?.failed||0},${stats?.skipped||0},${JSON.stringify(stats||{})},${JSON.stringify(brief||{})},${JSON.stringify(variants||[])},${campStatus},${scheduled_at||null},${JSON.stringify(schedule_config||{})})
          ON CONFLICT (id) DO UPDATE SET total_sent=EXCLUDED.total_sent, stats=EXCLUDED.stats, brief=EXCLUDED.brief, variants=EXCLUDED.variants, status=EXCLUDED.status, scheduled_at=EXCLUDED.scheduled_at, schedule_config=EXCLUDED.schedule_config
        `;
        if (campLeads?.length) {
          for (const l of campLeads) {
            await sql`
              INSERT INTO campaign_leads (campaign_id,user_id,lead_id,lead_name,lead_email,lead_company,status,subject,body,sent_at,variant_index)
              VALUES (${campId},${userId},${l.id},${l.name||""},${l.email||""},${l.company||""},${l.status||"sent"},${l.subject||""},${l.body||""},${Date.now()},${l.variantIndex||0})
            `.catch(()=>{});
          }
        }
        return res.json({ok:true,id:campId});
      }
    } catch(err) {
      return res.status(500).json({error:err.message});
    }
  }

  // ── LEAD TRACKING SUMMARY (for pipeline table) ───────────────────────
  if (type === "lead-tracking" && req.method === "GET") {
    try {
      const sql = getSql();

      // Only return tracking for leads that belong to the calling user.
      const userLeads = await safeGet(ns("crm:leads", userId), []);
      const userLeadIds = userLeads.map(l => l.id).filter(Boolean);
      if (userLeadIds.length === 0) return res.json({});

      const campId = req.query.campId || null;

      let tracking, lastEmails;

      if (campId) {
        // ── Per-campaign mode ─────────────────────────────────────────────────
        // Opens/clicks come from tracking_events (has campaign_id per event).
        // Last email comes from campaign_leads for THIS campaign, so subject
        // and sent date always show even for leads that haven't opened yet.
        [tracking, lastEmails] = await Promise.all([
          sql`
            SELECT lead_id,
              COUNT(*) FILTER (WHERE event_type = 'open'  AND (is_bot IS NOT TRUE)) AS opens,
              COUNT(*) FILTER (WHERE event_type = 'click' AND (is_bot IS NOT TRUE)) AS clicks
            FROM tracking_events
            WHERE lead_id = ANY(${userLeadIds}) AND campaign_id = ${campId}
            GROUP BY lead_id
          `.catch(() => []),
          sql`
            SELECT DISTINCT ON (lead_id) lead_id, subject, body, sent_at, status
            FROM campaign_leads
            WHERE lead_id = ANY(${userLeadIds}) AND campaign_id = ${campId}
            ORDER BY lead_id, sent_at DESC
          `.catch(() => []),
        ]);
      } else {
        // ── Aggregate mode: cumulative opens/clicks across all campaigns ──────
        [tracking, lastEmails] = await Promise.all([
          sql`SELECT lead_id, opens, clicks FROM simple_tracking WHERE lead_id = ANY(${userLeadIds})`.catch(() => []),
          sql`SELECT DISTINCT ON (lead_id) lead_id, subject, body, sent_at, status FROM campaign_leads WHERE lead_id = ANY(${userLeadIds}) ORDER BY lead_id, sent_at DESC`.catch(() => []),
        ]);
      }

      const map = {};
      tracking.forEach(t => {
        map[t.lead_id] = { opens: parseInt(t.opens)||0, clicks: parseInt(t.clicks)||0 };
      });
      lastEmails.forEach(e => {
        map[e.lead_id] = { ...(map[e.lead_id]||{}), subject: e.subject, body: e.body, sentAt: e.sent_at, emailStatus: e.status };
      });
      return res.json(map);
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── MARK REPLIED (feedback loop) ─────────────────────────────────────
  if (type === "mark-replied" && req.method === "POST") {
    try {
      const { leadId } = req.body;
      if (!leadId) return res.status(400).json({ error: "Missing leadId" });
      const sql = getSql();
      await sql`UPDATE campaign_leads SET status='replied' WHERE lead_id=${leadId} AND status='sent'`;
      return res.json({ ok: true });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── LEAD NOTES (activity timeline per lead) ───────────────────────────
  if (type === "notes") {
    try {
      const sql = getSql();
      await sql`CREATE TABLE IF NOT EXISTS lead_notes (
        id SERIAL PRIMARY KEY,
        lead_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        note_type TEXT DEFAULT 'note',
        created_at BIGINT NOT NULL
      )`.catch(()=>{});
      await sql`CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id, created_at DESC)`.catch(()=>{});

      const leadId = req.query.leadId || req.body?.leadId;

      if (req.method === "GET") {
        if (!leadId) return res.status(400).json({ error: "Missing leadId" });
        const notes = await sql`SELECT * FROM lead_notes WHERE lead_id=${leadId} ORDER BY created_at DESC LIMIT 100`;
        return res.json(notes);
      }
      if (req.method === "POST") {
        const { content, note_type = 'note' } = req.body;
        if (!leadId || !content) return res.status(400).json({ error: "Missing leadId or content" });
        const [note] = await sql`INSERT INTO lead_notes (lead_id, user_id, content, note_type, created_at) VALUES (${leadId}, ${userId}, ${content}, ${note_type}, ${Date.now()}) RETURNING *`;
        return res.json({ ok: true, note });
      }
      if (req.method === "DELETE") {
        const noteId = req.query.noteId;
        if (!noteId) return res.status(400).json({ error: "Missing noteId" });
        await sql`DELETE FROM lead_notes WHERE id=${noteId} AND (user_id=${userId} OR ${userId}='admin')`;
        return res.json({ ok: true });
      }
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ── CSV EXPORT ────────────────────────────────────────────────────────
  if (type === "csv-export" && req.method === "GET") {
    try {
      const leads = await safeGet(ns("crm:leads", userId), []);
      const stageF  = req.query.stage  || '';
      const statusF = req.query.status || '';
      const groupF  = req.query.group  || '';
      const filtered = leads.filter(l =>
        (!stageF  || l.pipelineStage === stageF)  &&
        (!statusF || l.status        === statusF) &&
        (!groupF  || l.group         === groupF)
      );
      const headers = ['name','email','company','phone','role','pipelineStage','status','priority','group','tags','notes','createdAt'];
      const rows = filtered.map(l => headers.map(h => {
        const v = l[h] ?? '';
        return `"${String(v).replace(/"/g,'""')}"`;
      }).join(','));
      const csv = [headers.join(','), ...rows].join('\r\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="leads-export-${Date.now()}.csv"`);
      return res.send(csv);
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ── INVOICES ──────────────────────────────────────────────────────────
  if (type === "invoices") {
    try {
      const sql = getSql();
      await sql`CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_id TEXT,
        client_name TEXT,
        client_email TEXT,
        number TEXT,
        items JSONB DEFAULT '[]',
        subtotal NUMERIC DEFAULT 0,
        tax NUMERIC DEFAULT 0,
        total NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'DRAFT',
        due_date TEXT,
        notes TEXT,
        created_at BIGINT NOT NULL
      )`.catch(()=>{});

      if (req.method === "GET" && id) {
        const [inv] = await sql`SELECT * FROM invoices WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`;
        if (!inv) return res.status(404).json({ error: "Not found" });
        return res.json({ ...inv, items: typeof inv.items === 'string' ? JSON.parse(inv.items||'[]') : inv.items });
      }
      if (req.method === "GET") {
        const rows = userId === 'admin'
          ? await sql`SELECT * FROM invoices ORDER BY created_at DESC`
          : await sql`SELECT * FROM invoices WHERE user_id=${userId} ORDER BY created_at DESC`;
        return res.json(rows.map(r => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items||'[]') : r.items })));
      }
      if (req.method === "POST") {
        const { client_id, client_name, client_email, items=[], subtotal=0, tax=0, total=0, due_date, notes='', status='DRAFT' } = req.body;
        const invId = `inv_${Date.now()}`;
        // Auto-increment invoice number
        const [last] = await sql`SELECT number FROM invoices WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 1`.catch(()=>[]);
        const lastNum = parseInt((last?.number||'INV-000').replace(/\D/g,'')) || 0;
        const number = `INV-${String(lastNum + 1).padStart(3,'0')}`;
        const [inv] = await sql`INSERT INTO invoices (id,user_id,client_id,client_name,client_email,number,items,subtotal,tax,total,status,due_date,notes,created_at)
          VALUES (${invId},${userId},${client_id||null},${client_name||''},${client_email||''},${number},${JSON.stringify(items)},${subtotal},${tax},${total},${status},${due_date||null},${notes},${Date.now()}) RETURNING *`;
        return res.json({ ok: true, invoice: { ...inv, items } });
      }
      if (req.method === "PUT" && id) {
        const { client_name, client_email, items, subtotal, tax, total, due_date, notes, status } = req.body;
        await sql`UPDATE invoices SET
          client_name  = COALESCE(${client_name  ?? null}, client_name),
          client_email = COALESCE(${client_email ?? null}, client_email),
          items        = COALESCE(${items        ? JSON.stringify(items) : null}::jsonb, items),
          subtotal     = COALESCE(${subtotal     ?? null}, subtotal),
          tax          = COALESCE(${tax          ?? null}, tax),
          total        = COALESCE(${total        ?? null}, total),
          due_date     = COALESCE(${due_date     ?? null}, due_date),
          notes        = COALESCE(${notes        ?? null}, notes),
          status       = COALESCE(${status       ?? null}, status)
          WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`;
        return res.json({ ok: true });
      }
      if (req.method === "DELETE" && id) {
        await sql`DELETE FROM invoices WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`;
        return res.json({ ok: true });
      }
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ── REVENUE STATS (pipeline + invoices) ──────────────────────────────
  if (type === "revenue" && req.method === "GET") {
    try {
      const sql = getSql();
      const [clients, deals] = await Promise.all([
        safeGet(ns("crm:clients", userId), []),
        safeGet(ns("crm:deals",   userId), []),
      ]);
      // Invoice revenue
      const invRows = await sql`SELECT status, SUM(total) as total FROM invoices WHERE user_id=${userId} OR ${userId}='admin' GROUP BY status`.catch(()=>[]);
      const invByStatus = {};
      invRows.forEach(r => { invByStatus[r.status] = parseFloat(r.total)||0; });

      // Pipeline value by stage
      const stageValue = {};
      deals.forEach(d => {
        const stage = d.stage || d.status || 'OPEN';
        stageValue[stage] = (stageValue[stage]||0) + (parseFloat(d.value)||0);
      });

      // Clients revenue
      const clientRevenue = clients.reduce((s,c) => s + (parseFloat(c.amount)||0), 0);
      const overdueRevenue = clients.filter(c=>c.paymentStatus==='OVERDUE').reduce((s,c)=>s+(parseFloat(c.amount)||0),0);

      return res.json({
        clientRevenue,
        overdueRevenue,
        invoices: invByStatus,
        pipeline: stageValue,
        totalInvoiced: Object.values(invByStatus).reduce((a,b)=>a+b,0),
        totalPaid: invByStatus['PAID']||0,
        totalPending: (invByStatus['SENT']||0) + (invByStatus['DRAFT']||0),
      });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ── DRIP SEQUENCES ────────────────────────────────────────────────────
  if (type === "drip-sequences") {
    try {
      const sql = getSql();
      await sql`CREATE TABLE IF NOT EXISTS drip_sequences (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
        steps JSONB DEFAULT '[]', active BOOLEAN DEFAULT TRUE, created_at BIGINT NOT NULL
      )`.catch(()=>{});
      await sql`CREATE TABLE IF NOT EXISTS drip_enrollments (
        id SERIAL PRIMARY KEY, sequence_id TEXT NOT NULL, lead_id TEXT NOT NULL,
        lead_email TEXT, lead_name TEXT, user_id TEXT NOT NULL,
        step_index INT DEFAULT 0, next_send_at BIGINT, status TEXT DEFAULT 'active',
        created_at BIGINT NOT NULL,
        UNIQUE(sequence_id, lead_id)
      )`.catch(()=>{});

      if (req.method === "GET" && id) {
        const [seq] = await sql`SELECT * FROM drip_sequences WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`.catch(()=>[]);
        if (!seq) return res.status(404).json({ error:"Not found" });
        const enrollments = await sql`SELECT * FROM drip_enrollments WHERE sequence_id=${id} ORDER BY created_at DESC`.catch(()=>[]);
        return res.json({ ...seq, steps: typeof seq.steps==='string'?JSON.parse(seq.steps||'[]'):seq.steps, enrollments });
      }
      if (req.method === "GET") {
        const rows = userId==='admin'
          ? await sql`SELECT * FROM drip_sequences ORDER BY created_at DESC`
          : await sql`SELECT * FROM drip_sequences WHERE user_id=${userId} ORDER BY created_at DESC`;
        return res.json(rows.map(r=>({ ...r, steps: typeof r.steps==='string'?JSON.parse(r.steps||'[]'):r.steps })));
      }
      if (req.method === "POST" && !id) {
        const { name, steps=[] } = req.body;
        if (!name) return res.status(400).json({ error: "Name required" });
        const seqId = `drip_${Date.now()}`;
        const [seq] = await sql`INSERT INTO drip_sequences (id,user_id,name,steps,created_at) VALUES (${seqId},${userId},${name},${JSON.stringify(steps)},${Date.now()}) RETURNING *`;
        return res.json({ ok:true, sequence: { ...seq, steps } });
      }
      if (req.method === "PUT" && id) {
        const { name, steps, active } = req.body;
        await sql`UPDATE drip_sequences SET
          name   = COALESCE(${name   ?? null}, name),
          steps  = COALESCE(${steps  ? JSON.stringify(steps) : null}::jsonb, steps),
          active = COALESCE(${active ?? null}, active)
          WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`;
        return res.json({ ok:true });
      }
      if (req.method === "DELETE" && id) {
        await sql`DELETE FROM drip_enrollments WHERE sequence_id=${id}`;
        await sql`DELETE FROM drip_sequences WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`;
        return res.json({ ok:true });
      }
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ── DRIP ENROLL ───────────────────────────────────────────────────────
  if (type === "drip-enroll" && req.method === "POST") {
    try {
      const sql = getSql();
      const { sequenceId, leads: enrollLeads = [] } = req.body;
      if (!sequenceId || !enrollLeads.length) return res.status(400).json({ error: "Missing sequenceId or leads" });
      const [seq] = await sql`SELECT * FROM drip_sequences WHERE id=${sequenceId}`.catch(()=>[]);
      if (!seq) return res.status(404).json({ error: "Sequence not found" });
      const steps = typeof seq.steps==='string' ? JSON.parse(seq.steps||'[]') : seq.steps;
      const firstDelay = steps[0]?.delayDays || 0;
      const nextSendAt = Date.now() + firstDelay * 86400000;
      let enrolled = 0;
      for (const l of enrollLeads) {
        await sql`INSERT INTO drip_enrollments (sequence_id,lead_id,lead_email,lead_name,user_id,step_index,next_send_at,created_at)
          VALUES (${sequenceId},${l.id},${l.email||''},${l.name||''},${userId},0,${nextSendAt},${Date.now()})
          ON CONFLICT (sequence_id,lead_id) DO NOTHING`.catch(()=>{});
        enrolled++;
      }
      return res.json({ ok:true, enrolled });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ── PURGE BOT OPENS — remove historical fake opens from known bot IPs ────────
  // Deletes tracking_events with is_bot=true AND recalculates simple_tracking counts.
  // Also deletes events from known bot IP ranges that slipped through before the fix.
  if (type === "purge-bot-opens" && req.method === "POST") {
    try {
      const sql = getSql();
      // Known bot IP prefixes that should never have been counted
      const botPrefixes = ['17.', '40.94.', '40.107.', '52.100.', '66.249.', '66.102.',
                           '104.47.', '172.253.', '130.211.', '35.190.', '23.21.', '54.240.'];
      const botIpConditions = botPrefixes.map(p => `ip LIKE '${p}%'`).join(' OR ');

      // 1. Mark any untagged bot events as is_bot=true
      const markedRes = await sql.unsafe(
        `UPDATE tracking_events SET is_bot = true WHERE event_type='open' AND is_bot IS DISTINCT FROM true AND (${botIpConditions})`
      );
      const marked = markedRes?.count || markedRes?.rowCount || 0;

      // 2. Recalculate simple_tracking opens for all affected leads
      // Get distinct lead_ids that had bot opens counted in simple_tracking
      const affected = await sql.unsafe(
        `SELECT DISTINCT lead_id FROM tracking_events WHERE event_type='open' AND (is_bot=true OR (${botIpConditions}))`
      );
      let recalculated = 0;
      for (const row of (affected || [])) {
        const lid = row.lead_id;
        // Count only real opens for this lead
        const realOpens = await sql`
          SELECT COUNT(*) as cnt FROM tracking_events
          WHERE lead_id=${lid} AND event_type='open' AND (is_bot IS NULL OR is_bot=false)
        `;
        const realCount = parseInt(realOpens[0]?.cnt || 0);
        const lastOpenRow = await sql`
          SELECT created_at FROM tracking_events
          WHERE lead_id=${lid} AND event_type='open' AND (is_bot IS NULL OR is_bot=false)
          ORDER BY created_at DESC LIMIT 1
        `;
        const lastOpen = lastOpenRow[0]?.created_at || null;
        if (realCount === 0) {
          await sql`DELETE FROM simple_tracking WHERE lead_id=${lid}`.catch(()=>{});
        } else {
          await sql`
            INSERT INTO simple_tracking (lead_id, opens, last_open) VALUES (${lid}, ${realCount}, ${lastOpen})
            ON CONFLICT (lead_id) DO UPDATE SET opens=${realCount}, last_open=${lastOpen}
          `.catch(()=>{});
        }
        recalculated++;
      }
      console.log(`🧹 [PURGE-BOT] Marked ${marked} bot events, recalculated ${recalculated} leads`);
      return res.json({ ok: true, marked, recalculated, affectedLeads: recalculated });
    } catch(err) {
      console.error('[PURGE-BOT] Error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(400).json({ error: "Invalid type parameter" });
};
