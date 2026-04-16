// api/_redis.js — Upstash Redis REST client with error handling
// Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

const BASE  = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command, ...args) {
  if (!BASE || !TOKEN) throw new Error("Redis env vars not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${BASE}/${[command, ...args].join("/")}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
    const data = await res.json();
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function get(key)                        { return redis("GET",  encodeURIComponent(key)); }
async function set(key, value, exSeconds=null) {
  if (exSeconds) return redis("SET", encodeURIComponent(key), encodeURIComponent(value), "EX", exSeconds);
  return redis("SET", encodeURIComponent(key), encodeURIComponent(value));
}
async function incr(key)  { return redis("INCR", encodeURIComponent(key)); }
async function del(key)   { return redis("DEL",  encodeURIComponent(key)); }

// HSET / HGET for structured per-lead event logs
async function hset(hash, field, value) {
  return redis("HSET", encodeURIComponent(hash), encodeURIComponent(field), encodeURIComponent(value));
}
async function hgetall(hash) {
  const raw = await redis("HGETALL", encodeURIComponent(hash));
  if (!raw || !Array.isArray(raw)) return {};
  const obj = {};
  for (let i = 0; i < raw.length; i += 2) obj[decodeURIComponent(raw[i])] = decodeURIComponent(raw[i+1]);
  return obj;
}

module.exports = { get, set, incr, del, hset, hgetall };
