// api/clients.js — Client CRUD
// GET  /api/clients          → list all clients
// POST /api/clients          → create client
// PUT  /api/clients?id=...   → update client
// DELETE /api/clients?id=... → delete client

const { get, set } = require("./_redis");

async function getClients() {
  const raw = await get("crm:clients");
  return raw ? JSON.parse(raw) : [];
}

async function saveClients(clients) {
  await set("crm:clients", JSON.stringify(clients));
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      return res.json(await getClients());
    }

    if (req.method === "POST") {
      const clients = await getClients();
      const client = {
        id: "client_" + Date.now(),
        createdAt: new Date().toISOString(),
        paymentStatus: "PENDING",
        renewalStatus: "ACTIVE",
        ...req.body,
      };
      clients.push(client);
      await saveClients(clients);
      return res.json({ ok: true, client });
    }

    if (req.method === "PUT") {
      const { id } = req.query;
      const clients = await getClients();
      const idx = clients.findIndex((c) => c.id === id);
      if (idx === -1) return res.status(404).json({ error: "Not found" });
      clients[idx] = { ...clients[idx], ...req.body, id };
      await saveClients(clients);
      return res.json({ ok: true, client: clients[idx] });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      const clients = await getClients();
      await saveClients(clients.filter((c) => c.id !== id));
      return res.json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("clients error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
