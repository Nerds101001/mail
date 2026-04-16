// api/_redis.js — Upstash Redis REST client
// Uses POST body for SET to handle large values (tokens, JSON blobs)

const BASE  = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command, ...args) {
  if (!BASE || !TOKEN) throw new Error("Redis env vars not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // Use POST with JSON body — handles large values, no URL length limit
    const res = await fetch(`${BASE}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([command, ...args]),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
    const data = await res.json();
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function get(key)   { return redis("GET", key); }
async function set(key, value, exSeconds = null) {
  if (exSeconds) return redis("SET", key, String(value), "EX", exSeconds);
  return redis("SET", key, String(value));
}
async function incr(key)  { return redis("INCR", key); }
async function del(key)   { return redis("DEL",  key); }

async function hset(hash, field, value) {
  return redis("HSET", hash, field, String(value));
}
async function hgetall(hash) {
  const raw = await redis("HGETALL", hash);
  if (!raw || !Array.isArray(raw)) return {};
  const obj = {};
  for (let i = 0; i < raw.length; i += 2) obj[raw[i]] = raw[i + 1];
  return obj;
}

module.exports = { get, set, incr, del, hset, hgetall };
