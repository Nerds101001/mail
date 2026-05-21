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

// ── Load API handlers ─────────────────────────────────────────────────────────
const gmail       = require("./api/gmail");
const crm         = require("./api/crm");
const ops         = require("./api/ops");
const auth        = require("./api/auth");
const sendEmail   = require("./api/send-email");
const sendSmtp    = require("./api/send-smtp");
const attachments = require("./api/attachments");
const trackOpen   = require("./api/track-open");
const trackClick  = require("./api/track-click");
const trackPixel  = require("./api/track-pixel");
const unsubscribe = require("./api/unsubscribe");
const dbCheck     = require("./api/db-check");

// Helper: merge extra query params before handing off to a handler
function withQuery(handler, params) {
  return (req, res) => { Object.assign(req.query, params); handler(req, res); };
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
app.all("/api/crm",            crm);

// Ops / tasks / scheduling
app.all("/api/tasks",          withQuery(ops, { type: "tasks" }));
app.all("/api/send-reminder",  withQuery(ops, { type: "reminder" }));
app.all("/api/run-scheduled",  withQuery(ops, { type: "run-scheduled" }));
app.all("/api/events",         withQuery(ops, { type: "events" }));
app.all("/api/ops",            ops);

// Auth
app.all("/api/auth", auth);

// Email sending
app.all("/api/send-email", sendEmail);
app.all("/api/send-smtp",  sendSmtp);

// Attachments
app.all("/api/attachments", attachments);

// Tracking (open/click pixels — must stay fast)
app.all("/api/track-open",  trackOpen);
app.all("/api/track-click", trackClick);
app.all("/api/track-pixel", trackPixel);

// Unsubscribe
app.all("/api/unsubscribe", unsubscribe);

// DB diagnostic (temporary)
app.all("/api/db-check", dbCheck);

// ── React frontend (must be LAST — catches all non-api routes) ────────────────
// Vite builds to ../public (relative to crm-ui/) = /public at project root
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ EnginErds CRM running → http://0.0.0.0:${PORT}`);
});
