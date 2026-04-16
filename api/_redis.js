// api/_redis.js — Key-value store backed by Neon Postgres (pooled connection)
const { neon } = require("@neondatabase/serverless");

function getDb() {
  // Use pooled connection URL if available (POSTGRES_URL is the pooled one from Vercel Neon)
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  return neon(url);
}

// Table is created once — cache the promise so it only runs once per instance
let tableReadyPromise = null;
function ensureTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = getDb()`
      CREATE TABLE IF NOT EXISTS kv_store (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        expires_at BIGINT DEFAULT NULL
      )
    `.catch(e => { tableReadyPromise = null; throw e; });
  }
  return tableReadyPromise;
}

async function get(key) {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`
    SELECT value FROM kv_store
    WHERE key = ${key}
      AND (expires_at IS NULL OR expires_at > ${Date.now()})
    LIMIT 1
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
      SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
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
