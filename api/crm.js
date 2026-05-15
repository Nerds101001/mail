// api/crm.js — Unified CRM data + Campaign history
// All data is namespaced by userId so each user sees only their own data
// Admin (userId=admin) can see all users' data

const { get, set } = require("./_redis");
const { neon } = require("@neondatabase/serverless");

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
    const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
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
      const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
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
      const sql = neon(dbUrl);

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
        const leads = await sql`SELECT * FROM campaign_leads WHERE campaign_id=${id} ORDER BY sent_at DESC`;
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
                total_sent, total_failed, total_skipped } = req.body;
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

        // leads_only=true — just insert leads into an existing campaign, don't touch campaign row
        if (leads_only && providedId && campLeads?.length) {
          for (const l of campLeads) {
            await sql`
              INSERT INTO campaign_leads (campaign_id,user_id,lead_id,lead_name,lead_email,lead_company,status,subject,body,sent_at,variant_index)
              VALUES (${campId},${userId},${l.id},${l.name||""},${l.email||""},${l.company||""},${l.status||"sent"},${l.subject||""},${l.body||""},${l.sentAt||Date.now()},${l.variantIndex||0})
            `.catch(()=>{});
          }
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
      const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);

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
              COUNT(*) FILTER (WHERE event_type = 'open')  AS opens,
              COUNT(*) FILTER (WHERE event_type = 'click') AS clicks
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
      const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
      const sql = neon(dbUrl);
      await sql`UPDATE campaign_leads SET status='replied' WHERE lead_id=${leadId} AND status='sent'`;
      return res.json({ ok: true });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(400).json({ error: "Invalid type parameter" });
};
