// api/_db.js — Shared Postgres connection for all API functions
// Works with local Postgres (EC2), AWS RDS, Supabase, or any standard Postgres
const postgres = require("postgres");

let _sql = null;

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  if (!_sql) {
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    _sql = postgres(url, {
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: isLocal ? 10 : 1,   // persistent server gets pool; serverless gets 1
      idle_timeout: 30,
      connect_timeout: 30,
    });
  }
  return _sql;
}

module.exports = { getSql };
