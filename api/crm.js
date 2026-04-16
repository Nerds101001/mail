// api/crm.js — Unified CRM data endpoint (replaces get-crm-data + save-crm-data + clients + deals)
// GET  /api/crm?type=load              → load all CRM data
// POST /api/crm?type=save              → save all CRM data
// GET  /api/crm?type=clients           → list clients
// POST /api/crm?type=clients           → create client
// PUT  /api/crm?type=clients&id=...    → update client
// DELETE /api/crm?type=clients&id=...  → delete client
// GET  /api/crm?type=deals             → list deals
// POST /api/crm?type=deals             → create deal
// PUT  /api/crm?type=deals&id=...      → update deal
// DELETE /api/crm?type=deals&id=...    → delete deal

const { get, set } = require("./_redis");

async function safeGet(key, fallback) {
  try { const v = await get(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
}
async function safeSet(key, value) {
  try { await set(key, JSON.stringify(value)); } catch(e) {}
}

function sanitizeProfiles(profiles) {
  if (!Array.isArray(profiles)) return profiles;
  return profiles.map(p => {
    if (p.type === "smtp") { const { pass, ...safe } = p; return { ...safe, hasPass: !!pass }; }
    return p;
  });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  const { type, id } = req.query;

  // ── LOAD ALL ─────────────────────────────────────────────────────────
  if (type === "load" && req.method === "GET") {
    const [leads, profiles, settings, activity, clients, deals] = await Promise.all([
      safeGet("crm:leads", []), safeGet("crm:profiles", []), safeGet("crm:settings", {}),
      safeGet("crm:activity", []), safeGet("crm:clients", []), safeGet("crm:deals", []),
    ]);
    return res.json({ leads, profiles, settings, activity, clients, deals });
  }

  // ── SAVE ALL ─────────────────────────────────────────────────────────
  if (type === "save" && req.method === "POST") {
    const { leads, profiles, settings, activity, clients, deals } = req.body;
    await Promise.all([
      leads    !== undefined ? safeSet("crm:leads",    leads) : null,
      profiles !== undefined ? safeSet("crm:profiles", sanitizeProfiles(profiles)) : null,
      settings !== undefined ? safeSet("crm:settings", (({openaiKey,...s})=>s)(settings||{})) : null,
      activity !== undefined ? safeSet("crm:activity", activity) : null,
      clients  !== undefined ? safeSet("crm:clients",  clients) : null,
      deals    !== undefined ? safeSet("crm:deals",    deals) : null,
    ].filter(Boolean));
    return res.json({ success: true });
  }

  // ── CLIENTS ───────────────────────────────────────────────────────────
  if (type === "clients") {
    const clients = await safeGet("crm:clients", []);
    if (req.method === "GET") return res.json(clients);
    if (req.method === "POST") {
      const client = { id: "client_" + Date.now(), createdAt: new Date().toISOString(), paymentStatus: "PENDING", renewalStatus: "ACTIVE", ...req.body };
      clients.push(client); await safeSet("crm:clients", clients);
      return res.json({ ok: true, client });
    }
    if (req.method === "PUT") {
      const idx = clients.findIndex(c => c.id === id);
      if (idx === -1) return res.status(404).json({ error: "Not found" });
      clients[idx] = { ...clients[idx], ...req.body, id };
      await safeSet("crm:clients", clients);
      return res.json({ ok: true, client: clients[idx] });
    }
    if (req.method === "DELETE") {
      await safeSet("crm:clients", clients.filter(c => c.id !== id));
      return res.json({ ok: true });
    }
  }

  // ── DEALS ─────────────────────────────────────────────────────────────
  if (type === "deals") {
    const deals = await safeGet("crm:deals", []);
    if (req.method === "GET") return res.json(deals);
    if (req.method === "POST") {
      const deal = { id: "deal_" + Date.now(), createdAt: new Date().toISOString(), status: "OPEN", type: "QUOTATION", ...req.body };
      deals.push(deal); await safeSet("crm:deals", deals);
      return res.json({ ok: true, deal });
    }
    if (req.method === "PUT") {
      const idx = deals.findIndex(d => d.id === id);
      if (idx === -1) return res.status(404).json({ error: "Not found" });
      deals[idx] = { ...deals[idx], ...req.body, id };
      await safeSet("crm:deals", deals);
      return res.json({ ok: true, deal: deals[idx] });
    }
    if (req.method === "DELETE") {
      await safeSet("crm:deals", deals.filter(d => d.id !== id));
      return res.json({ ok: true });
    }
  }

  res.status(400).json({ error: "Invalid type parameter" });
};
