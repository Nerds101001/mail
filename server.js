// server.js — Express server for AWS EC2 deployment
// Mirrors all vercel.json rewrites and serves the React frontend
require("dotenv").config();

const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ── CORS (same as vercel.json headers) ───────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin",  "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// ── Never let one bad request take the whole server down ─────────────────────
// Every API handler is an `async` function. Express 4 ignores the promise it returns, so a thrown
// error inside one (e.g. `username.trim is not a function` for a numeric username) became an
// unhandled rejection and Node EXITED — one anonymous request could kill the CRM, cutting any send
// in progress. safe() hands the error to Express instead (→ the JSON error handler at the bottom).
// When there is no `next` (the server's own timers below call handlers directly) it rethrows so
// their own `.catch` still sees it.
function safe(handler) {
  return (req, res, next) => {
    const onErr = (e) => { if (typeof next === "function") return next(e); throw e; };
    try { return Promise.resolve(handler(req, res, next)).catch(onErr); }
    catch (e) { return Promise.resolve().then(() => onErr(e)); }
  };
}
// A stray rejection elsewhere (a timer, a fire-and-forget call) is logged, not fatal. A genuine
// uncaught exception leaves the process in an unknown state → log, then exit so PM2 restarts it clean.
process.on("unhandledRejection", (reason) => console.error("⚠ [unhandledRejection]", (reason && reason.stack) || reason));
process.on("uncaughtException",  (err) => { console.error("💥 [uncaughtException]", (err && err.stack) || err); setTimeout(() => process.exit(1), 200); });

// ── Load API handlers ─────────────────────────────────────────────────────────
const gmail       = safe(require("./api/gmail"));
const crm         = safe(require("./api/crm"));
const ops         = safe(require("./api/ops"));
const auth        = safe(require("./api/auth"));
const { requireSendAuth } = require("./api/_internal");
const sendEmail   = safe(require("./api/send-email"));
const sendSmtp    = safe(require("./api/send-smtp"));
const attachments = safe(require("./api/attachments"));
const trackOpen   = safe(require("./api/track-open"));
const trackClick  = safe(require("./api/track-click"));
const trackPixel  = safe(require("./api/track-pixel"));
const sse         = safe(require("./api/sse"));
const unsubscribe = safe(require("./api/unsubscribe"));
const interest    = safe(require("./api/interest"));
const dbCheck     = safe(require("./api/db-check"));

// Helper: merge extra query params before handing off to a handler
function withQuery(handler, params) {
  return (req, res, next) => { Object.assign(req.query, params); return handler(req, res, next); };
}

// ── API routes (mirrors vercel.json rewrites exactly) ────────────────────────

// Gmail
app.all("/api/gmail-auth",     withQuery(gmail, { type: "auth" }));
app.all("/api/gmail-callback", withQuery(gmail, { type: "callback" }));
app.all("/api/gmail-status",   withQuery(gmail, { type: "status" }));
app.all("/api/gmail",          gmail);

// CRM data
app.all("/api/get-crm-data",   withQuery(crm, { type: "load" }));
app.all("/api/save-crm-data",  withQuery(crm, { type: "save" }));
app.all("/api/campaigns",      withQuery(crm, { type: "campaigns" }));
app.all("/api/notes",          withQuery(crm, { type: "notes" }));
app.all("/api/invoices",       withQuery(crm, { type: "invoices" }));
app.all("/api/csv-export",     withQuery(crm, { type: "csv-export" }));
app.all("/api/revenue",        withQuery(crm, { type: "revenue" }));
app.all("/api/drip-sequences", withQuery(crm, { type: "drip-sequences" }));
app.all("/api/drip-enroll",    withQuery(crm, { type: "drip-enroll" }));
app.all("/api/purge-bot-opens",withQuery(crm, { type: "purge-bot-opens" }));
app.all("/api/crm",            crm);

// Ops / tasks / scheduling
app.all("/api/tasks",          withQuery(ops, { type: "tasks" }));
app.all("/api/send-reminder",  withQuery(ops, { type: "reminder" }));
app.all("/api/run-scheduled",  withQuery(ops, { type: "run-scheduled" }));
app.all("/api/events",         withQuery(ops, { type: "events" }));
app.all("/api/check-replies",  withQuery(ops, { type: "check-replies" }));
app.all("/api/run-drip",       withQuery(ops, { type: "run-drip" }));
app.all("/api/check-bounces",   withQuery(ops, { type: "check-bounces" }));
app.all("/api/analytics",       withQuery(ops, { type: "analytics" }));
app.all("/api/send-time-stats", withQuery(ops, { type: "send-time-stats" }));
app.all("/api/ops",            ops);

// Auth
app.all("/api/auth", auth);

// Email sending
// These send real email from the connected accounts → logged-in users or the server's own jobs only.
app.all("/api/send-email", requireSendAuth, sendEmail);
app.all("/api/send-smtp",  requireSendAuth, sendSmtp);

// Attachments
app.all("/api/attachments", attachments);

// Tracking (open/click pixels — must stay fast)
app.all("/api/track-open",  trackOpen);
app.all("/api/track-click", trackClick);
app.all("/api/track-pixel", trackPixel);

// Real-time SSE stream (EC2 only — long-lived connection)
app.get("/api/sse", sse);

// Unsubscribe
app.all("/api/unsubscribe", unsubscribe);

// Interest response (Interested / Not Interested from email buttons)
app.all("/api/interest", interest);

// DB diagnostic (temporary)
app.all("/api/db-check", dbCheck);

// ── React frontend (must be LAST — catches all non-api routes) ────────────────
// Vite builds to ../public (relative to crm-ui/) = /public at project root
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ── Error handler (keep LAST) ─────────────────────────────────────────────────
// Anything a handler throws (see safe() above) or Express itself rejects (e.g. malformed JSON body)
// ends up here: a clean JSON error instead of a dead process or a stack-trace page.
app.use((err, req, res, next) => {
  const status = err && (err.status || err.statusCode) >= 400 && (err.status || err.statusCode) < 600 ? (err.status || err.statusCode) : 500;
  if (status >= 500) console.error(`[HTTP ${status}] ${req.method} ${req.path} →`, (err && err.stack) || err);
  if (res.headersSent) return next(err);
  res.status(status).json({ error: status >= 500 ? "Server error — please try again." : "Bad request." });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ EnginErds CRM running → http://0.0.0.0:${PORT}`);
});

// ── Feature 5: Auto-reply detection — runs every 5 minutes ───────────────────
// Calls the same check-replies handler with a synthetic req/res so it fires
// automatically without any manual button click.
function autoCheckReplies() {
  const fakeReq = {
    method:  'GET',
    query:   { type: 'check-replies' },
    headers: { authorization: '' },
    body:    {},
  };
  const fakeRes = {
    json:   (data) => {
      if (data.repliesFound > 0) {
        console.log(`🔔 [AUTO-REPLIES] Found ${data.repliesFound} new reply(ies):`, data.repliedLeads);
      }
    },
    status: (code) => ({ json: () => {} }),
  };
  ops(fakeReq, fakeRes).catch(err => {
    console.error('[AUTO-REPLIES] Error:', err.message);
  });
}

// Run once 30 seconds after startup (let DB settle), then every 5 minutes
setTimeout(() => {
  autoCheckReplies();
  setInterval(autoCheckReplies, 5 * 60 * 1000);
}, 30 * 1000);

// ── Auto-run drip sequences every 15 minutes ─────────────────────────────────
function autoDrip() {
  const fakeReq = {
    method:  'POST',
    query:   { type: 'run-drip' },
    headers: { authorization: '' },
    body:    {},
  };
  const fakeRes = {
    json:   (data) => {
      if (data.sent > 0 || data.skipped > 0) {
        console.log(`💧 [AUTO-DRIP] sent=${data.sent} skipped=${data.skipped} processed=${data.processed}`);
      }
    },
    status: (code) => ({ json: () => {} }),
  };
  ops(fakeReq, fakeRes).catch(err => {
    console.error('[AUTO-DRIP] Error:', err.message);
  });
}

setTimeout(() => {
  autoDrip();
  setInterval(autoDrip, 15 * 60 * 1000);
}, 60 * 1000);

// ── Next-day retry of failed emails + auto-continue after a daily limit ───────
// Every 15 minutes (business hours IST only — enforced inside the job). A failed email is
// never re-sent the same day. See api/_retryJob.js. Switch off with AUTO_RETRY=0.
const { runRetryJob } = require("./api/_retryJob");
function autoRetry() {
  runRetryJob().catch(err => console.error("🔁 [RETRY] job error:", err.message));
}
setTimeout(() => {
  autoRetry();
  setInterval(autoRetry, 15 * 60 * 1000);
}, 120 * 1000);
