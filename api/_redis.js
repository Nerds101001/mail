// api/_redis.js
// Upstash Redis via REST — no SDK needed, just fetch
// Set these in Vercel Environment Variables:
//   UPSTASH_REDIS_REST_URL  → from upstash.com dashboard
//   UPSTASH_REDIS_REST_TOKEN → from upstash.com dashboard

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command, ...args) {
  const res = await fetch(`${BASE}/${[command, ...args].join("/")}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

// GET a key
async function get(key) {
  return redis("GET", encodeURIComponent(key));
}

// SET a key with optional expiry (seconds)
async function set(key, value, exSeconds = null) {
  if (exSeconds) {
    return redis("SET", encodeURIComponent(key), encodeURIComponent(value), "EX", exSeconds);
  }
  return redis("SET", encodeURIComponent(key), encodeURIComponent(value));
}

// INCR (atomic increment — perfect for open/click counts)
async function incr(key) {
  return redis("INCR", encodeURIComponent(key));
}

// DELETE a key
async function del(key) {
  return redis("DEL", encodeURIComponent(key));
}

module.exports = { get, set, incr, del };
