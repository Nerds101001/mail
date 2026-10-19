// api/_retryJob.js — "try again tomorrow" (shared module; started by server.js every 15 min,
// never exposed over HTTP).
//
//  A. FAILED emails whose failure was TEMPORARY (nothing was sent) and whose retry time has
//     come (tomorrow 10:00 IST, see _retry.js) are sent again — identical subject/body, preferably
//     through a different sender. At most MAX_ATTEMPTS tries in total.
//  B. Campaigns paused because every sender hit its daily limit continue with their queued
//     (PENDING) leads once 24 h have passed.
//
// Safety rules:
//   · only between 10:00 and 20:00 IST, only for senders that still have room under their daily cap
//   · a failure whose outcome is unknown (timeout, lost connection) is never retried — it may have
//     been delivered, and a retry would send the same email twice (the sender marks those retry=false)
//   · each row is claimed before sending, so a crash can't produce a duplicate (a stale claim is
//     turned into FAILED "outcome unknown", never re-sent)
//   · AUTO_RETRY=0 switches everything off; unsubscribed leads are still skipped by the sender

const { getSql } = require("./_db");
const { get }    = require("./_redis");
const { internalFetch } = require("./_internal");
const { nextRetryAt, inSendWindow, ensureRetryColumns, retryEnabled, MAX_ATTEMPTS } = require("./_retry");

const DAY = 86400000;
let running = false;

const parseJson = v => {
  if (v && typeof v === "object") return v;
  try { const o = JSON.parse(v || "{}"); return typeof o === "string" ? JSON.parse(o) : o; } catch { return {}; }
};
const profileKey = p => p.user || p.email || "";
const dailyCap   = p => p.dailyCap || (p.type === "gmail" ? 500 : 50);

// Real sender: the app's own endpoint on this machine, authenticated with the in-memory internal key.
async function defaultSend(endpoint, payload) {
  const r = await internalFetch(endpoint, payload);
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

// "Quick Response" buttons — same markup the campaign runner builds in the browser.
function interestHtml(leadId, campaignId, rc) {
  if (!rc.showInterested && !rc.showNotInterested) return "";
  const base = process.env.APP_URL || "https://crm.enginerds.in";
  const lid = encodeURIComponent(leadId), cid = encodeURIComponent(campaignId || "");
  let h = `<div style="margin:20px 0 8px 0;padding:14px 16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">`;
  h += `<p style="margin:0 0 10px 0;font-size:13px;color:#475569;font-weight:500;">Quick Response:</p>`;
  if (rc.showInterested)    h += `<a href="${base}/api/interest?action=demo&lead=${lid}&campaign=${cid}" style="display:inline-block;margin-right:8px;margin-bottom:6px;padding:8px 18px;background:#10b981;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">&#9989; Yes, I'm Interested</a>`;
  if (rc.showNotInterested) h += `<a href="${base}/api/interest?action=unsub&lead=${lid}&campaign=${cid}" style="display:inline-block;margin-bottom:6px;padding:8px 18px;background:#f1f5f9;color:#64748b;text-decoration:none;border-radius:6px;font-size:13px;">&#10060; Not Interested</a>`;
  return h + `</div>`;
}

// Same subject/body rules as the browser runner (campaignRunner.js _getContent).
function buildContent(lead, rc, index) {
  const nameT = lead.name || "there", compT = lead.company || "your company";
  const sub = s => (s || "").replace(/\[Name\]/gi, nameT).replace(/\[Company\]/gi, compT).replace(/\[Role\]/gi, lead.role || "").replace(/their company/gi, compT);
  const inject = body => {
    if (!rc.usePersonalization || !lead.notes?.trim()) return body;
    const hook = `Given that ${compT} ${lead.notes.trim().replace(/^(is |are |has |have )/i, "")},`;
    return body.replace(/^(Hi [^\n,]+,\n\n)/i, `$1${hook} `);
  };
  const tail = rc.attachmentText || "";
  const variants = rc.variants || [];
  if (rc.mode === "custom") return { subject: sub(rc.customSubj), body: inject(sub(rc.customBody)) + tail, variantIndex: 0 };
  if (variants.length) {
    const vi = index % variants.length, v = variants[vi];
    return { subject: sub(v.subject), body: inject(sub(v.body)) + tail, variantIndex: vi };
  }
  return {
    subject: `Question for ${lead.company || "your business"}`,
    body: inject(`Hi ${lead.name || "there"},\n\nI noticed ${lead.company || "your business"} and thought we could help with your tech operations.\n\nBest regards,\nEnginerds Tech Solution`) + tail,
    variantIndex: 0,
  };
}

async function runRetryJob(opts = {}) {
  const now      = opts.now      ?? Date.now();
  const maxSends = opts.maxSends ?? 100;
  const sendFn   = opts.sendFn   ?? defaultSend;
  const sleep    = opts.sleep    ?? defaultSleep;
  const log      = opts.log      ?? ((...a) => console.log("🔁 [RETRY]", ...a));

  if (!retryEnabled())                                  return { ok: true, disabled: true };
  if (!opts.ignoreWindow && !inSendWindow(now))         return { ok: true, outsideWindow: true };
  if (running)                                          return { ok: true, busy: true };
  running = true;

  const sum = { retriedSent: 0, retriedFailedAgain: 0, deferred: 0, gaveUp: 0, resumedSent: 0, resumedFailed: 0, campaignsCompleted: 0 };
  let budget = maxSends;
  try {
    const sql = getSql();
    await ensureRetryColumns(sql);

    // A row claimed ("QUEUED") but never finished = the server died mid-send. Outcome unknown → never re-send.
    await sql`UPDATE campaign_leads SET status='FAILED', retry_at=NULL,
                failure_reason='Interrupted while sending — outcome unknown, check the Sent folder before resending'
              WHERE status='QUEUED' AND sent_at < ${now - 30 * 60000}`;

    const ctxCache = new Map();   // campaignId -> { camp, rc, profiles, state, leadMap }
    const getCtx = async (campId, campRow) => {
      if (ctxCache.has(campId)) return ctxCache.get(campId);
      const camp = campRow || (await sql`SELECT * FROM campaigns WHERE id=${campId}`)[0];
      if (!camp) return null;
      const rc = (parseJson(camp.schedule_config).resume_config) || {};
      const uid = camp.user_id;
      const raw = await get(!uid || uid === "admin" ? "crm:profiles" : `crm:profiles:${uid}`);
      let active = []; try { active = JSON.parse(raw || "[]").filter(p => p.active); } catch {}
      const wanted = (rc.senderProfiles || []).flatMap(p => [p.id, p.user, p.email]).filter(Boolean);
      const chosen = wanted.length ? active.filter(p => wanted.includes(p.id) || wanted.includes(p.user) || wanted.includes(p.email)) : active;
      const ctx = { camp, rc, profiles: chosen.length ? chosen : active, leadMap: null, rr: 0 };
      ctxCache.set(campId, ctx);
      return ctx;
    };
    // Per-sender state for this run, shared by ALL campaigns (two campaigns can use the same
    // account): sends in the last 24 h (vs its daily cap), broken, exhausted.
    const senderState = new Map();
    const stateOf = async (ctx, p) => {
      const k = profileKey(p);
      if (!senderState.has(k)) {
        const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM campaign_leads
                                  WHERE sender_email = ${k} AND sent_at > ${now - DAY} AND status IN ('SENT','REPLIED','BOUNCED')`;
        senderState.set(k, { used: n, cap: dailyCap(p), broken: false, exhausted: false });
      }
      return senderState.get(k);
    };
    const pickProfile = async (ctx, avoid) => {
      const usable = [];
      for (const p of ctx.profiles) { const s = await stateOf(ctx, p); if (!s.broken && !s.exhausted && s.used < s.cap) usable.push(p); }
      if (!usable.length) return null;
      const others = usable.filter(p => profileKey(p) !== avoid);
      const pool = others.length ? others : usable;
      return pool[ctx.rr++ % pool.length];
    };

    // Try to send one email. Returns { outcome, profile?, reason?, kind? } — outcome ∈
    // SENT | SKIPPED | BOUNCED | FAILED | NO_SENDER
    const attempt = async (ctx, leadId, to, subject, body, avoidSender) => {
      for (;;) {
        const profile = await pickProfile(ctx, avoidSender);
        if (!profile) return { outcome: "NO_SENDER" };
        const st = await stateOf(ctx, profile);
        const rc = ctx.rc;
        const payload = {
          leadId, to, subject, body, senderName: rc.senderName || ctx.camp.sender || "Enginerds Tech", replyTo: rc.replyTo || "",
          campaignId: ctx.camp.id, attachments: (rc.selectedAtts || []).map(a => ({ id: a.id })), interestHtml: interestHtml(leadId, ctx.camp.id, rc),
        };
        if (profile.type === "smtp") payload.smtpConfig = profile; else { payload.gmailUser = profile.user; if (profile.alias) payload.fromEmail = profile.alias; }
        let res;
        try { res = await sendFn(profile.type === "gmail" ? "/api/send-email" : "/api/send-smtp", payload); }
        catch (e) { return { outcome: "FAILED", kind: "unknown", reason: "Connection lost while sending — outcome unknown", profile }; }
        const { status, data } = res;
        if (data.rateLimited)          { st.exhausted = true; continue; }                       // another sender, same email
        if (data.kind === "sender")    { st.broken = true; log(`sender ${profileKey(profile)} unusable: ${data.reason || data.error}`); continue; }
        if (data.skipped)              return { outcome: "SKIPPED", reason: data.reason || "Unsubscribed", profile };
        if (data.bounced)              return { outcome: "BOUNCED", reason: data.reason || "Address rejected", profile };
        if (status >= 200 && status < 300 && data.success !== false && !data.error) { st.used++; return { outcome: "SENT", profile }; }
        const kind = (status === 502 || status === 504) ? "unknown" : (data.kind || "unknown");
        return { outcome: "FAILED", kind, reason: data.reason || data.error || `HTTP ${status}`, profile };
      }
    };
    const pause = async (ctx) => { const r = ctx.rc.cfg?.rate ?? 2; if (r > 0) await sleep(r * 1000); };

    // ── A. Failed emails due for their next-day retry ───────────────────────────
    const due = await sql`
      SELECT cl.*, c.status AS camp_status
      FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
      WHERE cl.status = 'FAILED' AND cl.retry_at IS NOT NULL AND cl.retry_at <= ${now}
        AND COALESCE(cl.attempts, 0) < ${MAX_ATTEMPTS}
        AND c.status <> 'CANCELLED'
        AND NOT (c.status = 'RUNNING' AND COALESCE((SELECT MAX(x.sent_at) FROM campaign_leads x WHERE x.campaign_id = c.id), 0) > ${now - 30 * 60000})
      ORDER BY cl.retry_at ASC LIMIT 300`;
    for (const row of due) {
      if (budget <= 0) break;
      const claimed = await sql`UPDATE campaign_leads SET retry_at = NULL WHERE id = ${row.id} AND retry_at = ${row.retry_at} RETURNING id`;
      if (!claimed.length) continue;
      const ctx = await getCtx(row.campaign_id);
      if (!ctx) continue;

      if (!row.subject || !row.body) {            // never happens for runner rows; be safe rather than send an empty email
        await sql`UPDATE campaign_leads SET failure_reason = 'Nothing to resend (subject/body missing)' WHERE id = ${row.id}`;
        continue;
      }
      const r = await attempt(ctx, row.lead_id, row.lead_email, row.subject, row.body, row.sender_email);
      const attempts = (row.attempts || 0) + 1;

      if (r.outcome === "NO_SENDER") {            // daily caps used up / accounts broken → not this lead's fault: try the next day, keep the attempt count
        if (now - Number(row.sent_at || 0) > 7 * DAY) {
          await sql`UPDATE campaign_leads SET failure_reason = 'Gave up: no sender account was available for 7 days' WHERE id = ${row.id}`;
          sum.gaveUp++;
        } else {
          await sql`UPDATE campaign_leads SET retry_at = ${nextRetryAt(now)} WHERE id = ${row.id}`;
          sum.deferred++;
        }
        continue;
      }
      budget--;
      const sender = r.profile ? profileKey(r.profile) : row.sender_email;
      if (r.outcome === "SENT") {
        await sql`UPDATE campaign_leads SET status='SENT', sent_at=${now}, failure_reason=NULL, retry_at=NULL, attempts=${attempts}, sender_email=${sender} WHERE id=${row.id}`;
        await sql`UPDATE campaigns SET total_sent = COALESCE(total_sent,0)+1, total_failed = GREATEST(COALESCE(total_failed,0)-1,0) WHERE id=${row.campaign_id}`;
        sum.retriedSent++; log(`✓ retried OK → ${row.lead_email} (attempt ${attempts}, via ${sender})`);
      } else if (r.outcome === "SKIPPED") {
        await sql`UPDATE campaign_leads SET status='SKIPPED', failure_reason=${r.reason}, retry_at=NULL, attempts=${attempts} WHERE id=${row.id}`;
        await sql`UPDATE campaigns SET total_skipped = COALESCE(total_skipped,0)+1, total_failed = GREATEST(COALESCE(total_failed,0)-1,0) WHERE id=${row.campaign_id}`;
      } else if (r.outcome === "BOUNCED") {
        await sql`UPDATE campaign_leads SET status='BOUNCED', failure_reason=${String(r.reason).slice(0, 500)}, retry_at=NULL, attempts=${attempts}, sender_email=${sender} WHERE id=${row.id}`;
      } else {                                    // FAILED again
        const again = r.kind === "transient" && attempts < MAX_ATTEMPTS;
        await sql`UPDATE campaign_leads SET failure_reason=${String(r.reason).slice(0, 500)}, attempts=${attempts}, sender_email=${sender}, sent_at=${now},
                    retry_at=${again ? nextRetryAt(now) : null} WHERE id=${row.id}`;
        sum.retriedFailedAgain++; log(`✗ retry failed → ${row.lead_email} (${r.kind}: ${r.reason})${again ? " — next try tomorrow" : " — giving up"}`);
      }
      await pause(ctx);
    }

    // ── B. Campaigns paused by the daily limit, 24 h later ──────────────────────
    const paused = await sql`SELECT * FROM campaigns WHERE status = 'PAUSED'`;
    for (const camp of paused) {
      if (budget <= 0) break;
      const sc = parseJson(camp.schedule_config);
      if (sc.cap_pause !== true || !sc.paused_at || now - Number(sc.paused_at) < DAY) continue;

      const ctx = await getCtx(camp.id, camp);
      if (!ctx || !ctx.profiles.length) continue;
      const pending = await sql`SELECT id, lead_id, lead_name, lead_email, lead_company FROM campaign_leads WHERE campaign_id=${camp.id} AND status='PENDING' ORDER BY id ASC LIMIT ${budget}`;
      if (!pending.length) { await sql`UPDATE campaigns SET status='COMPLETED' WHERE id=${camp.id}`; sum.campaignsCompleted++; continue; }

      if (!ctx.leadMap) {                          // full lead data (notes, role) for personalisation
        const uid = camp.user_id; ctx.leadMap = new Map();
        try { for (const l of JSON.parse((await get(!uid || uid === "admin" ? "crm:leads" : `crm:leads:${uid}`)) || "[]")) ctx.leadMap.set(String(l.id), l); } catch {}
      }
      log(`resuming "${camp.name}" after the daily limit: ${pending.length} queued lead(s)`);
      let stoppedNoSender = false, idx = 0;
      for (const row of pending) {
        const claimed = await sql`UPDATE campaign_leads SET status='QUEUED', sent_at=${now} WHERE id=${row.id} AND status='PENDING' RETURNING id`;
        if (!claimed.length) continue;             // the browser runner got it first
        const full = ctx.leadMap.get(String(row.lead_id)) || {};
        const lead = { id: row.lead_id, name: row.lead_name || full.name, company: row.lead_company || full.company, email: row.lead_email || full.email, notes: full.notes, role: full.role };
        const c = buildContent(lead, ctx.rc, idx++);
        const r = await attempt(ctx, row.lead_id, lead.email, c.subject, c.body, null);
        if (r.outcome === "NO_SENDER") {           // back to the queue, stop for today
          await sql`UPDATE campaign_leads SET status='PENDING', sent_at=NULL WHERE id=${row.id}`;
          stoppedNoSender = true; break;
        }
        budget--;
        const sender = r.profile ? profileKey(r.profile) : "";
        const retryAt = (r.outcome === "FAILED" && r.kind === "transient") ? nextRetryAt(now) : null;
        const finalStatus = r.outcome;              // SENT | SKIPPED | BOUNCED | FAILED
        await sql`UPDATE campaign_leads SET status=${finalStatus}, subject=${c.subject}, body=${c.body}, sent_at=${now}, variant_index=${c.variantIndex},
                    failure_reason=${finalStatus === "SENT" ? null : String(r.reason || "").slice(0, 500) || null}, sender_email=${sender || null},
                    attempts=COALESCE(attempts,0)+1, retry_at=${retryAt} WHERE id=${row.id}`;
        if (finalStatus === "SENT")         { await sql`UPDATE campaigns SET total_sent    = COALESCE(total_sent,0)+1    WHERE id=${camp.id}`; sum.resumedSent++; }
        else if (finalStatus === "SKIPPED") { await sql`UPDATE campaigns SET total_skipped = COALESCE(total_skipped,0)+1 WHERE id=${camp.id}`; }
        else                                { await sql`UPDATE campaigns SET total_failed  = COALESCE(total_failed,0)+1  WHERE id=${camp.id}`; sum.resumedFailed++; }
        await pause(ctx);
        if (budget <= 0) break;
      }
      const [{ n: left }] = await sql`SELECT COUNT(*)::int AS n FROM campaign_leads WHERE campaign_id=${camp.id} AND status='PENDING'`;
      if (left === 0) { await sql`UPDATE campaigns SET status='COMPLETED' WHERE id=${camp.id}`; sum.campaignsCompleted++; }
      else if (stoppedNoSender) {
        // Limits used up again → wait another day. If the cause is broken accounts instead, stop the
        // automatic daily attempts so the owner notices and fixes them (Resume stays available).
        const states = ctx.profiles.map(p => senderState.get(profileKey(p))).filter(Boolean);
        const allBroken = states.length > 0 && states.every(s => s.broken);
        const next = { ...sc, paused_at: now, pending_count: left, cap_pause: !allBroken, auto_resume_note: allBroken ? "All sender accounts have a problem — fix them in Settings, then Resume" : undefined };
        await sql`UPDATE campaigns SET schedule_config = ${JSON.stringify(next)}::jsonb WHERE id=${camp.id}`;
      }
    }
    if (sum.retriedSent + sum.retriedFailedAgain + sum.deferred + sum.resumedSent + sum.resumedFailed + sum.campaignsCompleted + sum.gaveUp > 0) log("run summary", JSON.stringify(sum));
    return { ok: true, ...sum };
  } finally {
    running = false;
  }
}

module.exports = { runRetryJob, buildContent, interestHtml };
