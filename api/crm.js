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
  const userId = await getUserIdFromToken(token);

  // ── LOAD ALL ─────────────────────────────────────────────────────────
  if (type === "load" && req.method === "GET") {
    const [leads, settings, activity, clients, deals, apikey] = await Promise.all([
      safeGet(ns("crm:leads", userId), []),
      safeGet("crm:settings", {}),           // settings are global
      safeGet(ns("crm:activity", userId), []),
      safeGet(ns("crm:clients", userId), []),
      safeGet(ns("crm:deals", userId), []),
      get("crm:apikey").catch(() => null),
    ]);
    // Profiles are shared (global)
    const profiles = await safeGet("crm:profiles", []);
    const mergedSettings = apikey ? { ...settings, openaiKey: apikey } : settings;
    return res.json({ leads, profiles, settings: mergedSettings, activity, clients, deals });
  }

  // ── SAVE ALL ─────────────────────────────────────────────────────────
  if (type === "save" && req.method === "POST") {
    const { leads, profiles, settings, activity, clients, deals } = req.body;
    await Promise.all([
      leads    !== undefined ? safeSet(ns("crm:leads",    userId), leads) : null,
      profiles !== undefined ? safeSet("crm:profiles", sanitizeProfiles(profiles)) : null, // shared
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

      await sql`CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at BIGINT, target TEXT, sender TEXT, total_sent INT DEFAULT 0, total_failed INT DEFAULT 0, total_skipped INT DEFAULT 0, stats JSONB DEFAULT '{}')`;
      await sql`CREATE TABLE IF NOT EXISTS campaign_leads (id SERIAL PRIMARY KEY, campaign_id TEXT, user_id TEXT, lead_id TEXT, lead_name TEXT, lead_email TEXT, lead_company TEXT, status TEXT DEFAULT 'sent', subject TEXT, body TEXT, sent_at BIGINT, opens INT DEFAULT 0, clicks INT DEFAULT 0)`;
      // Ensure all columns exist for existing tables
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS subject TEXT`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS body TEXT`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS opens INT DEFAULT 0`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS clicks INT DEFAULT 0`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS last_open BIGINT`.catch(()=>{});
      await sql`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS last_click BIGINT`.catch(()=>{});

      if (req.method === "GET" && id) {
        const [camp] = await sql`SELECT * FROM campaigns WHERE id=${id} AND (user_id=${userId} OR ${userId}='admin')`;
        if (!camp) return res.status(404).json({error:"Not found"});
        const leads = await sql`SELECT * FROM campaign_leads WHERE campaign_id=${id} ORDER BY sent_at DESC`;
        return res.json({...camp, stats:JSON.parse(camp.stats||"{}"), leads});
      }

      if (req.method === "GET") {
        const camps = userId === "admin"
          ? await sql`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`
          : await sql`SELECT * FROM campaigns WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 100`;
        return res.json(camps.map(c=>({...c,stats:JSON.parse(c.stats||"{}")})));
      }

      if (req.method === "POST") {
        const { id: providedId, name, target, sender, leads: campLeads, stats } = req.body;
        const campId = providedId || `camp_${Date.now()}`;
        await sql`INSERT INTO campaigns (id,user_id,name,created_at,target,sender,total_sent,total_failed,total_skipped,stats) VALUES (${campId},${userId},${name||"Campaign"},${Date.now()},${target||"all"},${sender||""},${stats?.sent||0},${stats?.failed||0},${stats?.skipped||0},${JSON.stringify(stats||{})}) ON CONFLICT (id) DO UPDATE SET total_sent=EXCLUDED.total_sent,stats=EXCLUDED.stats`;
        if (campLeads?.length) {
          for (const l of campLeads) {
            await sql`INSERT INTO campaign_leads (campaign_id,user_id,lead_id,lead_name,lead_email,lead_company,status,subject,body,sent_at) VALUES (${campId},${userId},${l.id},${l.name},${l.email},${l.company||""},${l.status||"sent"},${l.subject||""},${l.body||""},${Date.now()}) ON CONFLICT DO NOTHING`.catch(()=>{});
          }
        }
        return res.json({ok:true,id:campId});
      }
    } catch(err) {
      return res.status(500).json({error:err.message});
    }
  }

  res.status(400).json({ error: "Invalid type parameter" });
};
