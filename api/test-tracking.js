// api/test-tracking.js — Self-contained tracking system smoke test.
// Hit GET /api/test-tracking in the browser to verify the full flow works.
// Cleans up all test data after the run.

const { set, del, trackOpen, trackClick, getTrackingEvents, getDb, ensureTable } = require("./_redis");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  const startMs = Date.now();
  const testId  = `test_${startMs}`;
  const campId  = `camp_test_${startMs}`;
  const fakeIp  = "203.0.113.42"; // TEST-NET-3, never used on real internet
  const fakeUa  = "TestBrowser/1.0 (tracking-smoke-test)";
  const testUrl = "https://enginerds.in";

  const steps = [];
  function pass(name, detail = "") { steps.push({ name, ok: true,  detail }); }
  function fail(name, detail = "") { steps.push({ name, ok: false, detail }); }

  try {
    await ensureTable();
    pass("DB connect + ensureTable");
  } catch (e) {
    fail("DB connect + ensureTable", e.message);
    return send(res, steps, startMs);
  }

  // ── 1. Write guard key dated 20s in the past so the 15s window is clear ──
  try {
    const pastTs = Date.now() - 20000;
    await set(`email:guard:${testId}`, String(pastTs), 60);
    pass("Write guard key (20s ago)");
  } catch (e) {
    fail("Write guard key", e.message);
    return send(res, steps, startMs);
  }

  // ── 2. Track an open — should be counted ─────────────────────────────────
  let openResult;
  try {
    openResult = await trackOpen(testId, fakeIp, fakeUa, campId);
    if (openResult.counted) pass("trackOpen — counted", `total=${openResult.count}`);
    else                    fail("trackOpen — not counted", `reason=${openResult.reason}`);
  } catch (e) {
    fail("trackOpen", e.message);
    return send(res, steps, startMs);
  }

  // ── 3. Dedup: same IP+campaign within 2 minutes — should be skipped ─────
  try {
    const dup = await trackOpen(testId, fakeIp, fakeUa, campId);
    if (!dup.counted) pass("Dedup open — correctly skipped", `reason=${dup.reason}`);
    else              fail("Dedup open — was counted (dedup broken)");
  } catch (e) {
    fail("Dedup open", e.message);
  }

  // ── 4. Track a click — should be counted ─────────────────────────────────
  let clickResult;
  try {
    clickResult = await trackClick(testId, fakeIp, fakeUa, testUrl, campId);
    if (clickResult.counted) pass("trackClick — counted", `total=${clickResult.count}`);
    else                     fail("trackClick — not counted", `reason=${clickResult.reason}`);
  } catch (e) {
    fail("trackClick", e.message);
  }

  // ── 5. Verify events landed in tracking_events ────────────────────────────
  try {
    const events = await getTrackingEvents(testId, campId, 10);
    const openEv  = events.filter(e => e.event_type === "open");
    const clickEv = events.filter(e => e.event_type === "click");
    if (openEv.length  >= 1) pass("tracking_events has open",  `${openEv.length} event(s)`);
    else                     fail("tracking_events missing open", "logEvent may be failing");
    if (clickEv.length >= 1) pass("tracking_events has click", `${clickEv.length} event(s)`);
    else                     fail("tracking_events missing click", "logEvent may be failing");
  } catch (e) {
    fail("Read tracking_events", e.message);
  }

  // ── 6. Scanner-guard test: fire an open within 15s of a fresh guard ───────
  try {
    const freshId = `test_guard_${startMs}`;
    await set(`email:guard:${freshId}`, String(Date.now()), 60); // guard = now
    const blocked = await trackOpen(freshId, fakeIp, fakeUa, campId);
    if (!blocked.counted) pass("Scanner guard — correctly blocked early open", `reason=${blocked.reason}`);
    else                  fail("Scanner guard — early open was counted (guard broken)");
    await del(`email:guard:${freshId}`);
  } catch (e) {
    fail("Scanner guard test", e.message);
  }

  // ── 7. Cleanup test data ──────────────────────────────────────────────────
  try {
    const sql = getDb();
    await sql`DELETE FROM tracking_events WHERE lead_id = ${testId} OR lead_id LIKE ${'test_guard_%'}`;
    await sql`DELETE FROM simple_tracking  WHERE lead_id = ${testId}`;
    await del(`email:guard:${testId}`);
    pass("Cleanup test data");
  } catch (e) {
    fail("Cleanup", e.message);
  }

  return send(res, steps, startMs);
};

function send(res, steps, startMs) {
  const allOk   = steps.every(s => s.ok);
  const elapsed = Date.now() - startMs;
  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><title>Tracking Test</title>
<style>
  body{font-family:monospace;max-width:680px;margin:40px auto;padding:0 20px;background:#0d0d0d;color:#e0e0e0}
  h1{font-size:18px;margin-bottom:4px}
  .sub{font-size:12px;color:#888;margin-bottom:24px}
  .step{display:flex;gap:12px;align-items:flex-start;padding:8px 12px;border-radius:6px;margin-bottom:6px;font-size:13px}
  .ok{background:#0f2a0f;border:1px solid #1a5c1a}
  .fail{background:#2a0f0f;border:1px solid #5c1a1a}
  .icon{font-size:16px;flex-shrink:0;margin-top:1px}
  .name{flex:1;font-weight:600}
  .detail{color:#999;font-size:11px}
  .summary{margin-top:20px;padding:16px;border-radius:8px;font-size:15px;font-weight:700;text-align:center}
  .sum-ok{background:#0f3a0f;border:2px solid #22c55e;color:#22c55e}
  .sum-fail{background:#3a0f0f;border:2px solid #ef4444;color:#ef4444}
  .hint{margin-top:16px;font-size:11px;color:#666;text-align:center}
</style></head>
<body>
<h1>Tracking System Test</h1>
<div class="sub">Ran ${steps.length} checks in ${elapsed}ms</div>
${steps.map(s => `
<div class="step ${s.ok ? 'ok' : 'fail'}">
  <span class="icon">${s.ok ? '✅' : '❌'}</span>
  <span class="name">${esc(s.name)}</span>
  ${s.detail ? `<span class="detail">${esc(s.detail)}</span>` : ''}
</div>`).join('')}
<div class="summary ${allOk ? 'sum-ok' : 'sum-fail'}">
  ${allOk ? '✅ ALL CHECKS PASSED — Tracking is working correctly' : '❌ SOME CHECKS FAILED — see details above'}
</div>
<div class="hint">Refresh this page anytime to re-run. All test data is cleaned up automatically.</div>
</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.status(allOk ? 200 : 500).send(html);
}

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
