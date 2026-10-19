// api/_optout.js — the ONE place that knows who has opted out (shared module, not a route).
//
// Before this, "opted out" lived in four stores that nothing kept in sync:
//   kv `unsub:<email>` (checked at send time) · the lead's status in the CRM store ·
//   campaign_leads.status (read by the Unsubscribes list) · campaign_leads.interest_action.
// The "Not Interested" button wrote the first two but not the third, re-subscribe only touched
// the first, and a stale browser tab could overwrite the second. Now:
//
//   TABLE opt_outs (one row per address, lower-cased)  ← the single source of truth
//     · send-email / send-smtp refuse to send to any address in it (all campaigns, drips, retries)
//     · the Unsubscribes list reads it
//     · the CRM's load/save re-apply it to the lead records, so a stale tab can't revive anyone
//     · optOut()/optIn() are the only writers; they also keep the lead's status + pipeline stage in step
//
// Matching is by address, case-insensitive and trimmed. Opting out is global (every campaign,
// every user, every sending route).

const { getSql } = require("./_db");

const norm = e => String(e || "").trim().toLowerCase();

// ── schema + one-time import of the old scattered state (idempotent, runs once per process) ──────
let ready = null;
function ensureOptOutTable() {
  if (!ready) {
    ready = (async () => {
      const sql = getSql();
      await sql`CREATE TABLE IF NOT EXISTS opt_outs (
        email_lc    TEXT PRIMARY KEY,
        email       TEXT NOT NULL,
        lead_id     TEXT,
        user_id     TEXT,
        name        TEXT,
        company     TEXT,
        campaign_id TEXT,
        source      TEXT,
        prev_status TEXT,
        prev_stage  TEXT,
        created_at  BIGINT NOT NULL
      )`;
      const now = Date.now();
      const step = async (label, fn) => { try { await fn(); } catch (e) { console.error(`🚫 [OPT-OUT] import step "${label}" failed:`, e.message); } };

      // 1. the old send-block flags (kv unsub:<email>) — they are what actually blocked sends until now
      await step("legacy flags", () => sql`
        INSERT INTO opt_outs (email_lc, email, source, created_at)
        SELECT lower(trim(substr(key, 7))), trim(substr(key, 7)), 'legacy-flag', ${now}
        FROM kv_store WHERE key LIKE 'unsub:%' AND value = 'true' AND trim(substr(key, 7)) <> ''
        ON CONFLICT (email_lc) DO NOTHING`);
      // 2. delivery rows the old footer-link route had marked UNSUBSCRIBED
      await step("campaign rows", () => sql`
        INSERT INTO opt_outs (email_lc, email, lead_id, name, company, source, created_at)
        SELECT DISTINCT ON (lower(trim(lead_email))) lower(trim(lead_email)), trim(lead_email), lead_id, lead_name, lead_company, 'legacy-campaign', ${now}
        FROM campaign_leads WHERE status = 'UNSUBSCRIBED' AND coalesce(trim(lead_email), '') <> ''
        ORDER BY lower(trim(lead_email))
        ON CONFLICT (email_lc) DO NOTHING`);
      // 3. fill in who they are (lead id / owner / name / company) from the CRM lead stores
      await step("attribute", () => sql`
        UPDATE opt_outs o SET lead_id = coalesce(o.lead_id, x.id), name = coalesce(o.name, x.name), company = coalesce(o.company, x.company),
                              user_id = coalesce(o.user_id, x.uid)
        FROM (
          SELECT DISTINCT ON (lower(trim(e->>'email'))) lower(trim(e->>'email')) AS lc, e->>'id' AS id, e->>'name' AS name, e->>'company' AS company,
                 CASE WHEN k.key = 'crm:leads' THEN 'admin' ELSE substr(k.key, 11) END AS uid
          FROM kv_store k, jsonb_array_elements(k.value::jsonb) e
          WHERE k.key LIKE 'crm:leads%' AND jsonb_typeof(k.value::jsonb) = 'array' AND coalesce(e->>'email', '') <> ''
        ) x
        WHERE o.email_lc = x.lc AND (o.lead_id IS NULL OR o.user_id IS NULL OR o.name IS NULL)`);
      // 4. make the CRM lead records agree with the table (status + stage), once
      await step("reconcile leads", async () => { const n = await syncLeadStores(sql); if (n) console.log(`🚫 [OPT-OUT] reconciled ${n} CRM lead list(s) with the opt-out table`); });
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM opt_outs`;
      console.log(`🚫 [OPT-OUT] table ready — ${n} opted-out address(es)`);
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

// ── CRM lead stores (kv crm:leads / crm:leads:<userId>) ──────────────────────────────────────────
async function eachLeadStore(sql, fn) {
  const rows = await sql`SELECT key, value FROM kv_store WHERE key LIKE 'crm:leads%'`;
  let changedStores = 0;
  for (const r of rows) {
    let arr; try { arr = JSON.parse(r.value); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    const out = fn(arr, r.key);
    if (out) { await sql`UPDATE kv_store SET value = ${JSON.stringify(out)} WHERE key = ${r.key}`; changedStores++; }
  }
  return changedStores;
}
const ownerOfKey = key => (key === "crm:leads" ? "admin" : key.slice("crm:leads:".length));

// Make every lead whose address is opted out show UNSUBSCRIBED (status + stage), in all stores.
async function syncLeadStores(sql) {
  const set = new Set((await sql`SELECT email_lc FROM opt_outs`).map(r => r.email_lc));
  if (!set.size) return 0;
  return eachLeadStore(sql, arr => {
    let changed = false;
    const out = arr.map(l => {
      if (l && l.email && set.has(norm(l.email)) && (l.status !== "UNSUBSCRIBED" || l.pipelineStage !== "UNSUBSCRIBED")) {
        changed = true; return { ...l, status: "UNSUBSCRIBED", pipelineStage: "UNSUBSCRIBED" };
      }
      return l;
    });
    return changed ? out : null;
  });
}

// ── the API ──────────────────────────────────────────────────────────────────────────────────────
// Used by the send endpoints. THROWS if the check can't be made (the caller must not send then).
async function isOptedOut(email) {
  const lc = norm(email);
  if (!lc) return false;
  await ensureOptOutTable();
  const r = await getSql()`SELECT 1 FROM opt_outs WHERE email_lc = ${lc} LIMIT 1`;
  return r.length > 0;
}

// Find a lead (read-only) by id and/or address across every user's lead list.
async function lookupLead(sql, { leadId, email }) {
  const lc = norm(email);
  let hit = null;
  await eachLeadStore(sql, (arr, key) => {
    if (hit && hit.email) return null;
    const l = arr.find(x => x && ((leadId && x.id === leadId) || (lc && norm(x.email) === lc)));
    if (l) hit = { id: l.id, email: l.email, name: l.name, company: l.company, status: l.status, stage: l.pipelineStage, userId: ownerOfKey(key) };
    return null;
  });
  if (!hit && leadId) {                          // the lead may have been deleted from the CRM — the campaign rows still know the address
    const r = await sql`SELECT lead_email, lead_name, lead_company FROM campaign_leads WHERE lead_id = ${leadId} AND coalesce(lead_email, '') <> '' ORDER BY id DESC LIMIT 1`;
    if (r.length) hit = { id: leadId, email: r[0].lead_email, name: r[0].lead_name, company: r[0].lead_company };
  }
  return hit;
}

// Opt an address out. Idempotent. The table row is written FIRST, so sends are blocked even if the
// lead-record update below were to fail.
async function optOut({ email, leadId, campaignId, userId, name, company, source = "unknown" }) {
  await ensureOptOutTable();
  const sql = getSql();
  const found = await lookupLead(sql, { leadId, email });
  const em = String(email || found?.email || "").trim();
  if (!em) throw new Error("Cannot opt out: the email address of this lead is unknown");
  const lc = norm(em);

  await sql`
    INSERT INTO opt_outs (email_lc, email, lead_id, user_id, name, company, campaign_id, source, prev_status, prev_stage, created_at)
    VALUES (${lc}, ${em}, ${leadId || found?.id || null}, ${userId || found?.userId || null}, ${name || found?.name || null}, ${company || found?.company || null},
            ${campaignId || null}, ${source},
            ${found && found.status !== "UNSUBSCRIBED" ? found.status || null : null}, ${found && found.stage !== "UNSUBSCRIBED" ? found.stage || null : null}, ${Date.now()})
    ON CONFLICT (email_lc) DO UPDATE SET
      lead_id     = coalesce(opt_outs.lead_id, EXCLUDED.lead_id),     user_id     = coalesce(opt_outs.user_id, EXCLUDED.user_id),
      name        = coalesce(opt_outs.name, EXCLUDED.name),           company     = coalesce(opt_outs.company, EXCLUDED.company),
      campaign_id = coalesce(opt_outs.campaign_id, EXCLUDED.campaign_id),
      prev_status = coalesce(opt_outs.prev_status, EXCLUDED.prev_status), prev_stage = coalesce(opt_outs.prev_stage, EXCLUDED.prev_stage)`;

  const stamp = new Date().toISOString();
  await eachLeadStore(sql, arr => {
    let changed = false;
    const out = arr.map(l => {
      if (!l || !((leadId && l.id === leadId) || (l.email && norm(l.email) === lc))) return l;
      if (l.status === "UNSUBSCRIBED" && l.pipelineStage === "UNSUBSCRIBED") return l;
      changed = true;
      return { ...l, status: "UNSUBSCRIBED", pipelineStage: "UNSUBSCRIBED", notes: (l.notes || "") + `\n[${stamp}] Opted out (${source})` };
    });
    return changed ? out : null;
  });
  console.log(`🚫 [OPT-OUT] ${em} opted out (source: ${source}${campaignId ? ", campaign " + campaignId : ""})`);
  return { email: em, leadId: leadId || found?.id || null };
}

// Take an address off the list and put its lead records back the way they were before the opt-out.
async function optIn(email) {
  await ensureOptOutTable();
  const sql = getSql();
  const lc = norm(email);
  if (!lc) throw new Error("Missing email");
  const [row] = await sql`DELETE FROM opt_outs WHERE email_lc = ${lc} RETURNING *`;
  await sql`DELETE FROM kv_store WHERE key LIKE 'unsub:%' AND lower(trim(substr(key, 7))) = ${lc}`;   // old-style flags, any casing

  const status = row?.prev_status && row.prev_status !== "UNSUBSCRIBED" ? row.prev_status : "VALID";
  const stage  = row?.prev_stage && !["UNSUBSCRIBED", "NOT-INTERESTED"].includes(row.prev_stage) ? row.prev_stage : "COLD";
  const stamp = new Date().toISOString();
  let restored = 0;
  await eachLeadStore(sql, arr => {
    let changed = false;
    const out = arr.map(l => {
      if (!l || !l.email || norm(l.email) !== lc || (l.status !== "UNSUBSCRIBED" && l.pipelineStage !== "UNSUBSCRIBED")) return l;
      changed = true; restored++;
      return { ...l, status, pipelineStage: stage, notes: (l.notes || "") + `\n[${stamp}] Re-subscribed` };
    });
    return changed ? out : null;
  });
  console.log(`🚫 [OPT-OUT] ${lc} re-subscribed (${restored} lead record(s) restored to ${status}/${stage})`);
  return { email: String(email).trim(), wasOptedOut: !!row, restored, status, stage };
}

// The list shown on the Unsubscribes page. A normal user sees their own contacts; an admin sees all.
async function listOptOuts({ userId, isAdmin }) {
  await ensureOptOutTable();
  const sql = getSql();
  const rows = isAdmin
    ? await sql`SELECT * FROM opt_outs ORDER BY created_at DESC LIMIT 2000`
    : await sql`SELECT * FROM opt_outs WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 2000`;
  return rows.map(r => ({
    id: r.lead_id || r.email_lc, name: r.name || "", email: r.email, company: r.company || "",
    lastSent: Number(r.created_at), unsubscribedAt: Number(r.created_at), source: r.source || "", notes: "",
  }));
}

// Re-apply opt-outs to a lead array (used on CRM load and — crucially — on save, so an out-of-date
// browser tab can never put an opted-out lead back into circulation).
async function applyOptOuts(leads) {
  if (!Array.isArray(leads) || !leads.length) return { leads, changed: 0 };
  await ensureOptOutTable();
  const set = new Set((await getSql()`SELECT email_lc FROM opt_outs`).map(r => r.email_lc));
  if (!set.size) return { leads, changed: 0 };
  let changed = 0;
  const out = leads.map(l => {
    if (l && l.email && set.has(norm(l.email)) && (l.status !== "UNSUBSCRIBED" || l.pipelineStage !== "UNSUBSCRIBED")) {
      changed++; return { ...l, status: "UNSUBSCRIBED", pipelineStage: "UNSUBSCRIBED" };
    }
    return l;
  });
  return { leads: changed ? out : leads, changed };
}

async function isAdminSession(token) {
  if (!token) return false;
  try {
    const r = await getSql()`SELECT user_id, role FROM sessions WHERE token = ${token} AND expires_at > ${Date.now()} LIMIT 1`;
    return !!r.length && (r[0].role === "admin" || r[0].user_id === "admin");
  } catch { return false; }
}

module.exports = { norm, ensureOptOutTable, isOptedOut, optOut, optIn, listOptOuts, applyOptOuts, isAdminSession };
