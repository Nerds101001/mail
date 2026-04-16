// api/_redis.js — Key-value store backed by Neon Postgres
// Drops in as a Redis replacement with the same get/set/incr/del API
// Uses DATABASE_URL env var (auto-set by Vercel Neon integration)

const { neon } = require("@neondatabase/serverless");

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  return neon(url);
}

// Ensure the kv table exists (runs once per cold start, idempotent)
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS kv_store (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at BIGINT DEFAULT NULL
    )
  `;
  tableReady = true;
}

async function get(key) {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`
    SELECT value FROM kv_store
    WHERE key = ${key}
      AND (expires_at IS NULL OR expires_at > ${Date.now()})
  `;
  return rows[0]?.value ?? null;
}

async function set(key, value, exSeconds = null) {
  await ensureTable();
  const sql = getDb();
  const expiresAt = exSeconds ? Date.now() + exSeconds * 1000 : null;
  await sql`
    INSERT INTO kv_store (key, value, expires_at)
    VALUES (${key}, ${String(value)}, ${expiresAt})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          expires_at = EXCLUDED.expires_at
  `;
  return "OK";
}

async function incr(key) {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`
    INSERT INTO kv_store (key, value, expires_at)
    VALUES (${key}, '1', NULL)
    ON CONFLICT (key) DO UPDATE
      SET value = (CAST(kv_store.value AS BIGINT) + 1)::TEXT
    RETURNING value
  `;
  return parseInt(rows[0].value);
}

async function del(key) {
  await ensureTable();
  const sql = getDb();
  await sql`DELETE FROM kv_store WHERE key = ${key}`;
  return 1;
}

async function hset(hash, field, value) {
  return set(`${hash}:${field}`, value);
}

async function hgetall(hash) {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`
    SELECT key, value FROM kv_store
    WHERE key LIKE ${hash + ":%"}
      AND (expires_at IS NULL OR expires_at > ${Date.now()})
  `;
  const obj = {};
  const prefix = hash + ":";
  rows.forEach(r => { obj[r.key.slice(prefix.length)] = r.value; });
  return obj;
}

module.exports = { get, set, incr, del, hset, hgetall };
