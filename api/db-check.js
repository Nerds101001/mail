// api/db-check.js — Temporary diagnostic endpoint
// Checks database health and CRM data status
// DELETE THIS FILE after diagnosis is complete

const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  // Simple security: require a secret param to prevent public access
  if (req.query.key !== "diag_check_2024") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    return res.json({
      ok: false,
      error: "DATABASE_URL and POSTGRES_URL are both missing from environment variables",
      env_vars_present: Object.keys(process.env).filter(k => k.includes("DATABASE") || k.includes("POSTGRES") || k.includes("NEON"))
    });
  }

  try {
    const sql = neon(url);

    // Check which tables exist
    const tables = await sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;

    // Check kv_store row count and keys
    let kvCount = 0;
    let kvKeys = [];
    let sessions = [];
    let campaignLeads = { count: 0 };

    try {
      const rows = await sql`SELECT COUNT(*) as cnt FROM kv_store`;
      kvCount = parseInt(rows[0]?.cnt || 0);
    } catch(e) { kvCount = `ERROR: ${e.message}`; }

    try {
      const rows = await sql`SELECT key, LENGTH(value) as value_bytes FROM kv_store ORDER BY key LIMIT 50`;
      kvKeys = rows.map(r => ({ key: r.key, bytes: r.value_bytes }));
    } catch(e) { kvKeys = [`ERROR: ${e.message}`]; }

    try {
      const rows = await sql`SELECT COUNT(*) as cnt FROM sessions WHERE expires_at > ${Date.now()}`;
      sessions = { active: parseInt(rows[0]?.cnt || 0) };
    } catch(e) { sessions = { error: e.message }; }

    try {
      const rows = await sql`SELECT COUNT(*) as cnt FROM campaign_leads`;
      campaignLeads = { count: parseInt(rows[0]?.cnt || 0) };
    } catch(e) { campaignLeads = { error: e.message }; }

    // Show DB URL (masked for security)
    const maskedUrl = url.replace(/:([^@]+)@/, ':****@');

    return res.json({
      ok: true,
      db_url_masked: maskedUrl,
      tables: tables.map(t => t.tablename),
      kv_store: {
        total_rows: kvCount,
        keys: kvKeys
      },
      sessions,
      campaign_leads: campaignLeads,
      timestamp: new Date().toISOString()
    });

  } catch(e) {
    return res.json({
      ok: false,
      error: e.message,
      stack: e.stack?.split('\n').slice(0,5)
    });
  }
};
