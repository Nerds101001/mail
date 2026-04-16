// api/campaigns.js — Campaign history CRUD
// GET  /api/campaigns          → list all campaigns
// POST /api/campaigns          → create/save a campaign run
// GET  /api/campaigns?id=...   → get single campaign with lead details

const { neon } = require("@neondatabase/serverless");

function getDb() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  return neon(url);
}

async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS campaigns (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      created_at  BIGINT NOT NULL,
      status      TEXT DEFAULT 'completed',
      target      TEXT,
      sender      TEXT,
      total_sent  INT DEFAULT 0,
      total_failed INT DEFAULT 0,
      total_skipped INT DEFAULT 0,
      stats       TEXT DEFAULT '{}'
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS campaign_leads (
      id           SERIAL PRIMARY KEY,
      campaign_id  TEXT NOT NULL,
      lead_id      TEXT NOT NULL,
      lead_name    TEXT,
      lead_email   TEXT,
      lead_company TEXT,
      status       TEXT DEFAULT 'sent',
      subject      TEXT,
      sent_at      BIGINT,
      opens        INT DEFAULT 0,
      clicks       INT DEFAULT 0
    )
  `;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const sql = getDb();
    await ensureTables(sql);

    // GET single campaign
    if (req.method === "GET" && req.query.id) {
      const { id } = req.query;
      const [camp] = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
      if (!camp) return res.status(404).json({ error: "Not found" });
      const leads = await sql`SELECT * FROM campaign_leads WHERE campaign_id = ${id} ORDER BY sent_at DESC`;
      return res.json({ ...camp, stats: JSON.parse(camp.stats || "{}"), leads });
    }

    // GET all campaigns
    if (req.method === "GET") {
      const campaigns = await sql`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`;
      return res.json(campaigns.map(c => ({ ...c, stats: JSON.parse(c.stats || "{}") })));
    }

    // POST — save campaign run
    if (req.method === "POST") {
      const { id, name, target, sender, leads: campLeads, stats } = req.body;
      const campId = id || `camp_${Date.now()}`;

      await sql`
        INSERT INTO campaigns (id, name, created_at, target, sender, total_sent, total_failed, total_skipped, stats)
        VALUES (
          ${campId}, ${name || "Campaign " + new Date().toLocaleDateString()},
          ${Date.now()}, ${target || "all"}, ${sender || ""},
          ${stats?.sent || 0}, ${stats?.failed || 0}, ${stats?.skipped || 0},
          ${JSON.stringify(stats || {})}
        )
        ON CONFLICT (id) DO UPDATE SET
          total_sent = EXCLUDED.total_sent,
          total_failed = EXCLUDED.total_failed,
          total_skipped = EXCLUDED.total_skipped,
          stats = EXCLUDED.stats
      `;

      // Insert lead records
      if (campLeads?.length) {
        for (const l of campLeads) {
          await sql`
            INSERT INTO campaign_leads (campaign_id, lead_id, lead_name, lead_email, lead_company, status, subject, sent_at)
            VALUES (${campId}, ${l.id}, ${l.name}, ${l.email}, ${l.company || ""}, ${l.status || "sent"}, ${l.subject || ""}, ${Date.now()})
            ON CONFLICT DO NOTHING
          `;
        }
      }

      return res.json({ ok: true, id: campId });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("campaigns error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
