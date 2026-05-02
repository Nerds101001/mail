// api/test-e2e.js — Full HTTP-layer end-to-end tracking test.
// Hits /api/track-open and /api/track-click over real HTTP (not direct function calls)
// so it tests the exact same path a real email open/click would take.
// Visit: GET /api/test-e2e

const { set, del, getTrackingEvents, getDb, ensureTable } = require("./_redis");

const APP_URL = process.env.APP_URL || "https://enginerdsmail.vercel.app";

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  const startMs = Date.now();
  const testId  = `e2e_${startMs}`;
  const campId  = `camp_e2e_${startMs}`;
  const testUrl = "https://enginerds.in";

  const steps = [];
  function pass(name, detail = "") { steps.push({ name, ok: true,  detail }); }
  function fail(name, detail = "") { steps.push({ name, ok: false, detail }); }

  // ── 0. DB health check ────────────────────────────────────────────────────
  try {
    await ensureTable();
    pass("DB connected");
  } catch (e) {
    fail("DB connect", e.message);
    return send(res, steps, startMs, APP_URL);
  }

  // ── 1. Check APP_URL is a real URL ────────────────────────────────────────
  try {
    new URL(APP_URL);
    pass("APP_URL valid", APP_URL);
  } catch (e) {
    fail("APP_URL invalid", `Got: ${APP_URL}`);
    return send(res, steps, startMs, APP_URL);
  }

  // ── 2. Write guard key 20s in the past (clears the 15s scanner guard) ────
  try {
    const pastTs = Date.now() - 20000;
    await set(`email:guard:${testId}`, String(pastTs), 60);
    pass("Guard key set (20s ago)");
  } catch (e) {
    fail("Guard key write", e.message);
    return send(res, steps, startMs, APP_URL);
  }

  // ── 3. Hit track-open over real HTTP ─────────────────────────────────────
  const openUrl = `${APP_URL}/api/track-open?id=${testId}&cid=${campId}`;
  try {
    const r = await fetch(openUrl, { redirect: "manual" });
    // 302 = redirect means track-open responded correctly
    if (r.status === 302 || r.status === 200) {
      pass("track-open HTTP response", `status=${r.status} url=${openUrl}`);
    } else {
      fail("track-open HTTP response", `status=${r.status} expected 302`);
    }
  } catch (e) {
    fail("track-open HTTP fetch", `${e.message} — url=${openUrl}`);
  }

  // Give DB a moment to commit
  await new Promise(r => setTimeout(r, 1500));

  // ── 4. Verify open landed in tracking_events ─────────────────────────────
  try {
    const events = await getTrackingEvents(testId, campId, 10);
    const opens  = events.filter(e => e.event_type === "open");
    if (opens.length >= 1) {
      pass("Open recorded in DB", `${opens.length} event(s)`);
    } else {
      fail("Open NOT in DB", "trackOpen ran but nothing written — check Vercel logs");
    }
  } catch (e) {
    fail("Read open events", e.message);
  }

  // ── 5. Dedup: second request within 2 min should NOT add another event ────
  try {
    await fetch(openUrl, { redirect: "manual" });
    await new Promise(r => setTimeout(r, 1000));
    const events2 = await getTrackingEvents(testId, campId, 10);
    const opens2  = events2.filter(e => e.event_type === "open");
    if (opens2.length === 1) {
      pass("Dedup works (still 1 open after 2nd request)");
    } else if (opens2.length === 0) {
      fail("Dedup unknown — no opens at all");
    } else {
      fail("Dedup broken", `${opens2.length} opens instead of 1`);
    }
  } catch (e) {
    fail("Dedup check", e.message);
  }

  // ── 6. Hit track-click over real HTTP ────────────────────────────────────
  const clickUrl = `${APP_URL}/api/track-click?id=${testId}&cid=${campId}&url=${encodeURIComponent(testUrl)}`;
  try {
    const r = await fetch(clickUrl, { redirect: "manual" });
    if (r.status === 302 || r.status === 200) {
      pass("track-click HTTP response", `status=${r.status}`);
    } else {
      fail("track-click HTTP response", `status=${r.status} expected 302`);
    }
  } catch (e) {
    fail("track-click HTTP fetch", e.message);
  }

  await new Promise(r => setTimeout(r, 1500));

  // ── 7. Verify click landed in tracking_events ────────────────────────────
  try {
    const events = await getTrackingEvents(testId, campId, 10);
    const clicks = events.filter(e => e.event_type === "click");
    if (clicks.length >= 1) {
      pass("Click recorded in DB", `${clicks.length} event(s)`);
    } else {
      fail("Click NOT in DB", "trackClick ran but nothing written — check Vercel logs");
    }
  } catch (e) {
    fail("Read click events", e.message);
  }

  // ── 8. Cleanup ────────────────────────────────────────────────────────────
  try {
    const sql = getDb();
    await sql`DELETE FROM tracking_events WHERE lead_id = ${testId}`;
    await sql`DELETE FROM simple_tracking  WHERE lead_id = ${testId}`;
    await del(`email:guard:${testId}`);
    pass("Cleanup done");
  } catch (e) {
    fail("Cleanup", e.message);
  }

  return send(res, steps, startMs, APP_URL);
};

function send(res, steps, startMs, appUrl) {
  const allOk   = steps.every(s => s.ok);
  const elapsed = Date.now() - startMs;
  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><title>E2E Tracking Test</title>
<style>
  body{font-family:monospace;max-width:720px;margin:40px auto;padding:0 20px;background:#0d0d0d;color:#e0e0e0}
  h1{font-size:18px;margin-bottom:2px}
  .sub{font-size:12px;color:#666;margin-bottom:4px}
  .url{font-size:11px;color:#888;margin-bottom:24px;word-break:break-all}
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
  .logs{margin-top:16px;font-size:11px;color:#888;text-align:center}
</style></head>
<body>
<h1>E2E Tracking Test</h1>
<div class="sub">Hits real HTTP endpoints — same path as a live email open/click</div>
<div class="url">Testing: ${esc(appUrl)}</div>
${steps.map(s => `
<div class="step ${s.ok ? 'ok' : 'fail'}">
  <span class="icon">${s.ok ? '✅' : '❌'}</span>
  <div>
    <div class="name">${esc(s.name)}</div>
    ${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ''}
  </div>
</div>`).join('')}
<div class="summary ${allOk ? 'sum-ok' : 'sum-fail'}">
  ${allOk ? '✅ ALL PASSED — Tracking is working end-to-end' : '❌ FAILURES DETECTED — see red steps above'}
</div>
<div class="hint">Ran ${steps.length} checks in ${elapsed}ms &nbsp;·&nbsp; Refresh to re-run &nbsp;·&nbsp; All test data auto-cleaned</div>
<div class="logs">If DB steps pass but HTTP steps fail, check Vercel function logs for the error detail.</div>
</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.status(allOk ? 200 : 500).send(html);
}

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
