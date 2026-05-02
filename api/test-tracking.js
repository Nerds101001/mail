// api/test-tracking.js
// Visit GET /api/test-tracking        — DB-layer smoke test (fast, no HTTP)
// Visit GET /api/test-tracking?e2e=1  — Full HTTP-layer end-to-end test

const { set, del, trackOpen, trackClick, getTrackingEvents, getDb, ensureTable } = require("./_redis");

const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.query.e2e === "1") return runE2E(req, res);
  return runUnit(req, res);
};

// ── Full HTTP-layer E2E test ───────────────────────────────────────────────
async function runE2E(req, res) {
  const startMs = Date.now();
  const testId  = `e2e_${startMs}`;
  const campId  = `camp_e2e_${startMs}`;
  const testUrl = "https://enginerds.in";
  const steps   = [];
  const pass = (name, detail = "") => steps.push({ name, ok: true,  detail });
  const fail = (name, detail = "") => steps.push({ name, ok: false, detail });

  try { await ensureTable(); pass("DB connected"); }
  catch (e) { fail("DB connect", e.message); return sendHtml(res, steps, startMs, APP_URL, "E2E"); }

  try { new URL(APP_URL); pass("APP_URL valid", APP_URL); }
  catch (e) { fail("APP_URL invalid", `Got: ${APP_URL}`); return sendHtml(res, steps, startMs, APP_URL, "E2E"); }

  // Write guard key 20s in the past so 15s scanner guard is cleared
  try {
    await set(`email:guard:${testId}`, String(Date.now() - 20000), 60);
    pass("Guard key set (20s ago)");
  } catch (e) { fail("Guard key write", e.message); return sendHtml(res, steps, startMs, APP_URL, "E2E"); }

  // Hit track-open over real HTTP
  const openUrl = `${APP_URL}/api/track-open?id=${testId}&cid=${campId}`;
  try {
    const r = await fetch(openUrl, { redirect: "manual" });
    (r.status === 302 || r.status === 200)
      ? pass("track-open HTTP response", `status=${r.status}`)
      : fail("track-open HTTP response", `status=${r.status} expected 302 — url=${openUrl}`);
  } catch (e) { fail("track-open HTTP fetch", `${e.message} — url=${openUrl}`); }

  await new Promise(r => setTimeout(r, 1500));

  // Verify open landed in DB
  try {
    const events = await getTrackingEvents(testId, campId, 10);
    const opens  = events.filter(e => e.event_type === "open");
    opens.length >= 1
      ? pass("Open recorded in DB", `${opens.length} event(s)`)
      : fail("Open NOT in DB", "HTTP hit ok but nothing written — check Vercel logs for track-open errors");
  } catch (e) { fail("Read open events", e.message); }

  // Dedup: second request within 2 min must not add another event
  try {
    await fetch(openUrl, { redirect: "manual" });
    await new Promise(r => setTimeout(r, 1000));
    const events2 = await getTrackingEvents(testId, campId, 10);
    const opens2  = events2.filter(e => e.event_type === "open");
    opens2.length === 1
      ? pass("Dedup works (still 1 open after 2nd request)")
      : opens2.length === 0
        ? fail("Dedup unknown — no opens at all")
        : fail("Dedup broken", `${opens2.length} opens instead of 1`);
  } catch (e) { fail("Dedup check", e.message); }

  // Hit track-click over real HTTP
  const clickUrl = `${APP_URL}/api/track-click?id=${testId}&cid=${campId}&url=${encodeURIComponent(testUrl)}`;
  try {
    const r = await fetch(clickUrl, { redirect: "manual" });
    (r.status === 302 || r.status === 200)
      ? pass("track-click HTTP response", `status=${r.status}`)
      : fail("track-click HTTP response", `status=${r.status} expected 302`);
  } catch (e) { fail("track-click HTTP fetch", e.message); }

  await new Promise(r => setTimeout(r, 1500));

  // Verify click landed in DB
  try {
    const events = await getTrackingEvents(testId, campId, 10);
    const clicks = events.filter(e => e.event_type === "click");
    clicks.length >= 1
      ? pass("Click recorded in DB", `${clicks.length} event(s)`)
      : fail("Click NOT in DB", "HTTP hit ok but nothing written — check Vercel logs for track-click errors");
  } catch (e) { fail("Read click events", e.message); }

  // Cleanup
  try {
    const sql = getDb();
    await sql`DELETE FROM tracking_events WHERE lead_id = ${testId}`;
    await sql`DELETE FROM simple_tracking  WHERE lead_id = ${testId}`;
    await del(`email:guard:${testId}`);
    pass("Cleanup done");
  } catch (e) { fail("Cleanup", e.message); }

  return sendHtml(res, steps, startMs, APP_URL, "E2E (HTTP layer)");
}

// ── DB-layer unit test ─────────────────────────────────────────────────────
async function runUnit(req, res) {
  const startMs = Date.now();
  const testId  = `test_${startMs}`;
  const campId  = `camp_test_${startMs}`;
  const fakeIp  = "203.0.113.42";
  const fakeUa  = "TestBrowser/1.0 (tracking-smoke-test)";
  const testUrl = "https://enginerds.in";
  const steps   = [];
  const pass = (name, detail = "") => steps.push({ name, ok: true,  detail });
  const fail = (name, detail = "") => steps.push({ name, ok: false, detail });

  try { await ensureTable(); pass("DB connect + ensureTable"); }
  catch (e) { fail("DB connect + ensureTable", e.message); return sendHtml(res, steps, startMs, APP_URL, "Unit"); }

  try {
    await set(`email:guard:${testId}`, String(Date.now() - 20000), 60);
    pass("Write guard key (20s ago)");
  } catch (e) { fail("Write guard key", e.message); return sendHtml(res, steps, startMs, APP_URL, "Unit"); }

  try {
    const r = await trackOpen(testId, fakeIp, fakeUa, campId);
    r.counted ? pass("trackOpen — counted", `total=${r.count}`) : fail("trackOpen — not counted", `reason=${r.reason}`);
  } catch (e) { fail("trackOpen", e.message); return sendHtml(res, steps, startMs, APP_URL, "Unit"); }

  try {
    const dup = await trackOpen(testId, fakeIp, fakeUa, campId);
    !dup.counted ? pass("Dedup open — correctly skipped", `reason=${dup.reason}`) : fail("Dedup open — was counted (dedup broken)");
  } catch (e) { fail("Dedup open", e.message); }

  try {
    const r = await trackClick(testId, fakeIp, fakeUa, testUrl, campId);
    r.counted ? pass("trackClick — counted", `total=${r.count}`) : fail("trackClick — not counted", `reason=${r.reason}`);
  } catch (e) { fail("trackClick", e.message); }

  try {
    const events = await getTrackingEvents(testId, campId, 10);
    events.filter(e => e.event_type === "open").length >= 1  ? pass("tracking_events has open")  : fail("tracking_events missing open");
    events.filter(e => e.event_type === "click").length >= 1 ? pass("tracking_events has click") : fail("tracking_events missing click");
  } catch (e) { fail("Read tracking_events", e.message); }

  try {
    const freshId = `test_guard_${startMs}`;
    await set(`email:guard:${freshId}`, String(Date.now()), 60);
    const blocked = await trackOpen(freshId, fakeIp, fakeUa, campId);
    !blocked.counted ? pass("Scanner guard — correctly blocked early open", `reason=${blocked.reason}`) : fail("Scanner guard — early open was counted (guard broken)");
    await del(`email:guard:${freshId}`);
  } catch (e) { fail("Scanner guard test", e.message); }

  try {
    const sql = getDb();
    await sql`DELETE FROM tracking_events WHERE lead_id = ${testId} OR lead_id LIKE ${'test_guard_%'}`;
    await sql`DELETE FROM simple_tracking  WHERE lead_id = ${testId}`;
    await del(`email:guard:${testId}`);
    pass("Cleanup test data");
  } catch (e) { fail("Cleanup", e.message); }

  return sendHtml(res, steps, startMs, APP_URL, "Unit (DB layer)");
}

// ── HTML renderer ─────────────────────────────────────────────────────────
function sendHtml(res, steps, startMs, appUrl, mode) {
  const allOk   = steps.every(s => s.ok);
  const elapsed = Date.now() - startMs;
  const isE2E   = mode.startsWith("E2E");

  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><title>Tracking Test — ${esc(mode)}</title>
<style>
  body{font-family:monospace;max-width:720px;margin:40px auto;padding:0 20px;background:#0d0d0d;color:#e0e0e0}
  h1{font-size:18px;margin-bottom:2px}
  .sub{font-size:12px;color:#666;margin-bottom:4px}
  .url{font-size:11px;color:#555;margin-bottom:24px;word-break:break-all}
  .step{display:flex;gap:12px;align-items:flex-start;padding:8px 12px;border-radius:6px;margin-bottom:6px;font-size:13px}
  .ok{background:#0f2a0f;border:1px solid #1a5c1a}
  .fail{background:#2a0f0f;border:1px solid #5c1a1a}
  .icon{font-size:16px;flex-shrink:0;margin-top:1px}
  .name{flex:1;font-weight:600}
  .detail{color:#999;font-size:11px;margin-top:2px;word-break:break-all}
  .summary{margin-top:20px;padding:16px;border-radius:8px;font-size:15px;font-weight:700;text-align:center}
  .sum-ok{background:#0f3a0f;border:2px solid #22c55e;color:#22c55e}
  .sum-fail{background:#3a0f0f;border:2px solid #ef4444;color:#ef4444}
  .hint{margin-top:12px;font-size:11px;color:#555;text-align:center}
  a{color:#888}
</style></head>
<body>
<h1>Tracking Test — ${esc(mode)}</h1>
<div class="sub">Ran ${steps.length} checks in ${elapsed}ms</div>
<div class="url">App: ${esc(appUrl)}</div>
${steps.map(s => `
<div class="step ${s.ok ? 'ok' : 'fail'}">
  <span class="icon">${s.ok ? '✅' : '❌'}</span>
  <div>
    <div class="name">${esc(s.name)}</div>
    ${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ''}
  </div>
</div>`).join('')}
<div class="summary ${allOk ? 'sum-ok' : 'sum-fail'}">
  ${allOk ? '✅ ALL PASSED' : '❌ FAILURES — see red steps above'}
</div>
<div class="hint">
  <a href="?${isE2E ? "" : "e2e=1"}">Switch to ${isE2E ? "Unit (DB)" : "E2E (HTTP)"} mode</a>
  &nbsp;·&nbsp; Refresh to re-run &nbsp;·&nbsp; Test data auto-cleaned
</div>
</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.status(allOk ? 200 : 500).send(html);
}

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
