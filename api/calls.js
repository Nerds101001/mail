// api/calls.js — AI voice calls through Retell (https://docs.retellai.com)
//
//   POST /api/calls?type=start        { leadId, to? }   → start an OUTBOUND call to a lead (logged-in user)
//   GET  /api/calls?type=list&leadId= → call history (own leads; admin sees all)
//   GET  /api/calls?type=status       → is Retell configured? which number/agent (no secrets)
//   POST /api/calls?type=webhook      → Retell → us (call_started / call_ended / call_analyzed), HMAC-verified
//
// Config lives in the server's .env, never in the UI or the database:
//   RETELL_API_KEY        from the Retell dashboard (also the webhook signing key)
//   RETELL_AGENT_ID       the agent to use for calls started from the CRM
//   RETELL_FROM_NUMBER    E.164 number bought/imported in Retell, e.g. +1415XXXXXXX
//
// What a finished call does to the lead (call_analyzed): a note with the summary, pipeline stage from
// the outcome (interested → DEMO; not interested → NOT-INTERESTED; "do not call" → opt-out), a row
// in the `calls` table that the Calls page shows. Everything is idempotent: Retell retries webhooks.

const crypto = require("crypto");
const { getSql } = require("./_db");
const { sessionUserId } = require("./_signature");
const { optOut, isOptedOut } = require("./_optout");
const { strictGet, strictSet } = require("./_redis");

const API = "https://api.retellai.com";
const cfg = () => ({
  key: process.env.RETELL_API_KEY || "",
  agentId: process.env.RETELL_AGENT_ID || "",
  from: process.env.RETELL_FROM_NUMBER || "",
});

// ── storage ──────────────────────────────────────────────────────────────────────────────────────
let ready = null;
function ensureTable() {
  if (!ready) ready = (async () => {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS calls (
      call_id        TEXT PRIMARY KEY,
      lead_id        TEXT,
      user_id        TEXT,
      direction      TEXT,
      from_number    TEXT,
      to_number      TEXT,
      lead_name      TEXT,
      lead_email     TEXT,
      status         TEXT,
      started_at     BIGINT,
      ended_at       BIGINT,
      duration_ms    INT,
      disconnection  TEXT,
      outcome        TEXT,
      sentiment      TEXT,
      summary        TEXT,
      transcript     TEXT,
      recording_url  TEXT,
      analysis       JSONB,
      cost_cents     INT,
      applied        BOOLEAN NOT NULL DEFAULT false,
      created_at     BIGINT NOT NULL,
      updated_at     BIGINT NOT NULL
    )`;
    await sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS applied BOOLEAN NOT NULL DEFAULT false`.catch(() => {});
    await sql`CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls(lead_id)`.catch(() => {});
    await sql`CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(user_id, created_at)`.catch(() => {});
  })().catch(e => { ready = null; throw e; });
  return ready;
}

// ── phone numbers ────────────────────────────────────────────────────────────────────────────────
// Leads are mostly Indian: a bare 10-digit mobile becomes +91XXXXXXXXXX. Anything already in +E.164
// form is kept. Returns null when it can't be made into a dialable number.
function toE164(raw, defaultCc = process.env.DEFAULT_COUNTRY_CODE || "91") {
  let s = String(raw || "").replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
  s = s.replace(/^0+/, "");
  if (/^\d{10}$/.test(s)) return `+${defaultCc}${s}`;
  if (/^\d{11,15}$/.test(s)) return `+${s}`;
  return null;
}

// ── lead lookup across every user's list (same pattern as _optout.lookupLead) ───────────────────
async function findLead(sql, leadId) {
  const rows = await sql`SELECT key, value FROM kv_store WHERE key LIKE 'crm:leads%'`;
  for (const r of rows) {
    let arr; try { arr = JSON.parse(r.value); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    const l = arr.find(x => x && x.id === leadId);
    if (l) return { lead: l, key: r.key, userId: r.key === "crm:leads" ? "admin" : r.key.slice("crm:leads:".length) };
  }
  return null;
}

// Change one lead inside its list (read-modify-write guarded by strictGet so a DB hiccup can't wipe it).
async function patchLead(key, leadId, fn) {
  const arr = await strictGet(key, []);
  if (!Array.isArray(arr)) return false;
  let hit = false;
  const out = arr.map(l => { if (l && l.id === leadId) { hit = true; return fn(l); } return l; });
  if (hit) await strictSet(key, out);
  return hit;
}

// ── Retell HTTP ──────────────────────────────────────────────────────────────────────────────────
async function retell(path, body, method = "POST") {
  const { key } = cfg();
  const r = await fetch(API + path, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`Retell ${method} ${path} → HTTP ${r.status}: ${(json && (json.message || json.error)) || text.slice(0, 200)}`);
  return json;
}

// Webhook signature: X-Retell-Signature = "v=<ms timestamp>,d=<hex hmac-sha256(rawBody + timestamp, API key)>"
function verifySignature(rawBody, header, key) {
  const m = /v=(\d+),d=([0-9a-f]+)/i.exec(String(header || ""));
  if (!m || !key) return false;
  const [, ts, digest] = m;
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return false;            // replay window
  const expected = crypto.createHmac("sha256", key).update(Buffer.concat([Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)), Buffer.from(ts)])).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(digest.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── outcome of a finished call → what the CRM does with the lead ─────────────────────────────────
// The agent's post-call analysis can set custom_analysis_data.outcome (we ask for one of:
// interested | callback | not_interested | do_not_call | no_answer | voicemail | other). If the
// agent didn't, we derive it from the disconnection reason.
function deriveOutcome(call) {
  const a = call.call_analysis || {};
  const custom = a.custom_analysis_data || {};
  const explicit = String(custom.outcome || custom.call_outcome || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (explicit) return explicit;
  const d = String(call.disconnection_reason || "");
  if (d === "user_requested_dnc") return "do_not_call";
  if (d === "user_requested_callback") return "callback";
  if (/^dial_no_answer|^dial_busy|^dial_failed|invalid_destination/.test(d)) return "no_answer";
  if (d === "voicemail_reached" || a.in_voicemail) return "voicemail";
  if (a.call_successful === true) return "completed";
  return "other";
}

async function applyOutcome(sql, row, call) {
  const outcome = row.outcome;
  const found = row.lead_id ? await findLead(sql, row.lead_id) : null;
  const stamp = new Date().toISOString();
  const summary = (call.call_analysis && call.call_analysis.call_summary) || "";
  const noteLine = `\n[${stamp}] 📞 ${row.direction === "inbound" ? "Inbound" : "Outbound"} AI call (${Math.round((row.duration_ms || 0) / 1000)}s) — ${outcome}${summary ? ": " + summary.slice(0, 400) : ""}`;

  if (outcome === "do_not_call") {
    // the person asked not to be contacted: a real opt-out (same table every send path checks)
    try { await optOut({ leadId: row.lead_id || undefined, email: row.lead_email || undefined, userId: row.user_id, source: "ai-call-dnc" }); }
    catch (e) { console.warn("[CALLS] opt-out after do_not_call failed:", e.message); }
  }
  if (!found) return;
  const STAGE = { interested: "DEMO", callback: "HOT", not_interested: "NOT-INTERESTED" }[outcome];
  await patchLead(found.key, row.lead_id, l => {
    const next = { ...l, notes: (l.notes || "") + noteLine, lastCallAt: row.ended_at || Date.now(), lastCallOutcome: outcome };
    const terminal = new Set(["WON", "LOST", "UNSUBSCRIBED"]);
    if (STAGE && !terminal.has(l.pipelineStage)) next.pipelineStage = STAGE;
    return next;
  }).catch(e => console.warn("[CALLS] lead note/stage update failed:", e.message));
}

// Upsert what we know about a call. `event` decides how much is final.
async function recordCall(call, event) {
  const sql = getSql();
  const md = call.metadata || {};
  const existing = (await sql`SELECT lead_id, user_id, lead_name, lead_email FROM calls WHERE call_id = ${call.call_id}`)[0];
  let leadId = md.leadId || (existing && existing.lead_id) || null;
  let userId = md.userId || (existing && existing.user_id) || null;
  let leadName = md.leadName || (existing && existing.lead_name) || null;
  let leadEmail = md.leadEmail || (existing && existing.lead_email) || null;

  // inbound call: match the caller's number to a lead
  if (!leadId && call.direction === "inbound" && call.from_number) {
    const rows = await sql`SELECT key, value FROM kv_store WHERE key LIKE 'crm:leads%'`;
    const want = call.from_number.replace(/\D/g, "").slice(-10);
    outer: for (const r of rows) {
      let arr; try { arr = JSON.parse(r.value); } catch { continue; }
      if (!Array.isArray(arr)) continue;
      for (const l of arr) {
        if (l && l.phone && String(l.phone).replace(/\D/g, "").slice(-10) === want) {
          leadId = l.id; leadName = l.name || null; leadEmail = l.email || null;
          userId = r.key === "crm:leads" ? "admin" : r.key.slice("crm:leads:".length); break outer;
        }
      }
    }
  }

  const final = event === "call_analyzed";
  const a = call.call_analysis || {};
  const outcome = (event === "call_ended" || final) ? deriveOutcome(call) : null;
  const now = Date.now();
  const costCents = call.call_cost && Number.isFinite(call.call_cost.combined_cost) ? Math.round(call.call_cost.combined_cost) : null;
  await sql`
    INSERT INTO calls (call_id, lead_id, user_id, direction, from_number, to_number, lead_name, lead_email, status, started_at, ended_at, duration_ms,
                       disconnection, outcome, sentiment, summary, transcript, recording_url, analysis, cost_cents, created_at, updated_at)
    VALUES (${call.call_id}, ${leadId}, ${userId}, ${call.direction || null}, ${call.from_number || null}, ${call.to_number || null}, ${leadName}, ${leadEmail},
            ${call.call_status || event}, ${call.start_timestamp || null}, ${call.end_timestamp || null}, ${call.duration_ms || null},
            ${call.disconnection_reason || null}, ${outcome}, ${a.user_sentiment || null}, ${a.call_summary || null}, ${call.transcript || null},
            ${call.recording_url || null}, ${final ? JSON.stringify(a) : null}, ${costCents}, ${now}, ${now})
    ON CONFLICT (call_id) DO UPDATE SET
      lead_id = COALESCE(calls.lead_id, EXCLUDED.lead_id), user_id = COALESCE(calls.user_id, EXCLUDED.user_id),
      lead_name = COALESCE(calls.lead_name, EXCLUDED.lead_name), lead_email = COALESCE(calls.lead_email, EXCLUDED.lead_email),
      status = EXCLUDED.status, started_at = COALESCE(EXCLUDED.started_at, calls.started_at), ended_at = COALESCE(EXCLUDED.ended_at, calls.ended_at),
      duration_ms = COALESCE(EXCLUDED.duration_ms, calls.duration_ms), disconnection = COALESCE(EXCLUDED.disconnection, calls.disconnection),
      outcome = COALESCE(EXCLUDED.outcome, calls.outcome), sentiment = COALESCE(EXCLUDED.sentiment, calls.sentiment),
      summary = COALESCE(EXCLUDED.summary, calls.summary), transcript = COALESCE(EXCLUDED.transcript, calls.transcript),
      recording_url = COALESCE(EXCLUDED.recording_url, calls.recording_url), analysis = COALESCE(EXCLUDED.analysis, calls.analysis),
      cost_cents = COALESCE(EXCLUDED.cost_cents, calls.cost_cents), updated_at = EXCLUDED.updated_at`;

  // apply the outcome to the lead exactly once: the final event claims the `applied` column
  // atomically, so a retried webhook (Retell retries up to 3×) cannot add the note twice
  if (final) {
    const claimed = await sql`UPDATE calls SET applied = true WHERE call_id = ${call.call_id} AND applied = false RETURNING call_id`;
    if (claimed.length) await applyOutcome(sql, { lead_id: leadId, user_id: userId, lead_email: leadEmail, direction: call.direction, duration_ms: call.duration_ms, ended_at: call.end_timestamp, outcome }, call);
  }
  return { leadId, outcome };
}

// ── handler ──────────────────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  const type = req.query.type;

  // Retell → us. Public URL, authenticated by the HMAC signature, never by a session.
  if (type === "webhook") {
    if (req.method !== "POST") return res.status(405).end();
    const { key } = cfg();
    const raw = req.rawBody !== undefined ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
    if (!verifySignature(raw, req.headers["x-retell-signature"], key)) {
      console.warn("[CALLS] webhook with bad/missing signature rejected");
      return res.status(401).end();
    }
    const { event, call } = req.body || {};
    if (!call || !call.call_id) return res.status(400).end();
    try {
      await ensureTable();
      if (["call_started", "call_ended", "call_analyzed"].includes(event)) {
        const r = await recordCall(call, event);
        console.log(`📞 [CALLS] ${event} ${call.call_id} ${call.direction || ""} lead=${r.leadId || "-"} outcome=${r.outcome || "-"}`);
      }
    } catch (e) {
      console.error("[CALLS] webhook processing failed:", e.message);
      return res.status(500).end();     // Retell retries up to 3× → we get another chance
    }
    return res.status(204).end();
  }

  // everything below needs a logged-in user (strict session lookup)
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim() || req.query.token;
  const userId = await sessionUserId(token);
  if (!userId) return res.status(401).json({ error: "Login required" });
  const isAdmin = userId === "admin" || await isAdminRole(token);

  if (type === "status") {
    await ensureTable().catch(e => console.warn("[CALLS] table init:", e.message));
    const c = cfg();
    return res.json({ configured: !!(c.key && c.agentId && c.from), agentId: c.agentId ? c.agentId.slice(0, 12) + "…" : null, fromNumber: c.from || null, hasKey: !!c.key });
  }

  if (type === "list") {
    try {
      await ensureTable();
      const sql = getSql();
      const leadId = req.query.leadId || null;
      const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
      const rows = await sql`
        SELECT call_id, lead_id, user_id, direction, from_number, to_number, lead_name, lead_email, status, started_at, ended_at, duration_ms,
               disconnection, outcome, sentiment, summary, recording_url, cost_cents, created_at
        FROM calls
        WHERE (${isAdmin}::boolean OR user_id = ${userId}) AND (${leadId}::text IS NULL OR lead_id = ${leadId})
        ORDER BY created_at DESC LIMIT ${limit}`;
      return res.json({ calls: rows });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (type === "transcript") {
    try {
      await ensureTable();
      const r = await getSql()`SELECT transcript, analysis FROM calls WHERE call_id = ${req.query.callId} AND (${isAdmin}::boolean OR user_id = ${userId})`;
      if (!r.length) return res.status(404).json({ error: "Not found" });
      return res.json({ transcript: r[0].transcript || "", analysis: r[0].analysis || {} });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (type === "start" && req.method === "POST") {
    const c = cfg();
    if (!c.key || !c.agentId || !c.from) return res.status(503).json({ error: "Calling is not set up yet — RETELL_API_KEY, RETELL_AGENT_ID and RETELL_FROM_NUMBER must be in the server .env" });
    const { leadId } = req.body || {};
    if (!leadId) return res.status(400).json({ error: "Missing leadId" });
    try {
      await ensureTable();
      const sql = getSql();
      const found = await findLead(sql, leadId);
      if (!found) return res.status(404).json({ error: "Lead not found" });
      if (!isAdmin && found.userId !== userId) return res.status(403).json({ error: "Not your lead" });
      const to = toE164(req.body.to || found.lead.phone);
      if (!to) return res.status(400).json({ error: "This lead has no valid phone number (need a 10-digit mobile or +country number)" });
      if (found.lead.email && await isOptedOut(found.lead.email)) return res.status(409).json({ error: "This contact has opted out — not calling" });
      if (["UNSUBSCRIBED", "NOT-INTERESTED"].includes(found.lead.pipelineStage)) return res.status(409).json({ error: `Lead is ${found.lead.pipelineStage} — not calling` });

      const call = await retell("/v2/create-phone-call", {
        from_number: c.from, to_number: to, override_agent_id: c.agentId,
        metadata: { leadId, userId: found.userId, leadName: found.lead.name || "", leadEmail: found.lead.email || "", startedBy: userId },
        retell_llm_dynamic_variables: {
          lead_name: String(found.lead.name || "").trim() || "there",
          company: String(found.lead.company || "").trim() || "your company",
          role: String(found.lead.role || ""),
          notes: String(found.lead.notes || "").slice(-300),
        },
      });
      const now = Date.now();
      await sql`INSERT INTO calls (call_id, lead_id, user_id, direction, from_number, to_number, lead_name, lead_email, status, created_at, updated_at)
                VALUES (${call.call_id}, ${leadId}, ${found.userId}, 'outbound', ${c.from}, ${to}, ${found.lead.name || null}, ${found.lead.email || null}, ${call.call_status || "registered"}, ${now}, ${now})
                ON CONFLICT (call_id) DO NOTHING`;
      await patchLead(found.key, leadId, l => ({ ...l, notes: (l.notes || "") + `\n[${new Date().toISOString()}] 📞 AI call started to ${to}`, lastCallAt: now })).catch(() => {});
      console.log(`📞 [CALLS] outbound ${call.call_id} → lead ${leadId} (${to}) by ${userId}`);
      return res.json({ ok: true, callId: call.call_id, to });
    } catch (e) {
      console.error("[CALLS] start failed:", e.message);
      return res.status(502).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "Use ?type=start | list | transcript | status | webhook" });
};

async function isAdminRole(token) {
  try { const r = await getSql()`SELECT role FROM sessions WHERE token = ${token} AND expires_at > ${Date.now()} LIMIT 1`; return !!r.length && r[0].role === "admin"; }
  catch { return false; }
}

module.exports.toE164 = toE164;
module.exports.verifySignature = verifySignature;
module.exports.deriveOutcome = deriveOutcome;
