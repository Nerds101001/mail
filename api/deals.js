// api/deals.js — Deals/Quotations/Demo Calls CRUD
// GET  /api/deals          → list all deals
// POST /api/deals          → create deal
// PUT  /api/deals?id=...   → update deal
// DELETE /api/deals?id=... → delete deal

const { get, set } = require("./_redis");

async function getDeals() {
  const raw = await get("crm:deals");
  return raw ? JSON.parse(raw) : [];
}

async function saveDeals(deals) {
  await set("crm:deals", JSON.stringify(deals));
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      return res.json(await getDeals());
    }

    if (req.method === "POST") {
      const deals = await getDeals();
      const deal = {
        id: "deal_" + Date.now(),
        createdAt: new Date().toISOString(),
        status: "OPEN",
        type: "QUOTATION", // QUOTATION | DEMO | ORDER
        ...req.body,
      };
      deals.push(deal);
      await saveDeals(deals);
      return res.json({ ok: true, deal });
    }

    if (req.method === "PUT") {
      const { id } = req.query;
      const deals = await getDeals();
      const idx = deals.findIndex((d) => d.id === id);
      if (idx === -1) return res.status(404).json({ error: "Not found" });
      deals[idx] = { ...deals[idx], ...req.body, id };
      await saveDeals(deals);
      return res.json({ ok: true, deal: deals[idx] });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      const deals = await getDeals();
      await saveDeals(deals.filter((d) => d.id !== id));
      return res.json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("deals error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
