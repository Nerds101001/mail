// api/tracking-stats.js
// Handles two routes in one file (Vercel routes by filename):
//   GET /api/tracking-stats?ids=id1,id2,...  → { leadId: { opens, clicks } }
//   GET /api/gmail-status                    → { connected, email, tokenExpired }

const { get } = require("./_redis");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  const path = req.url.split("?")[0];

  // ── /api/gmail-status ────────────────────────────────────────────────
  if (path === "/api/gmail-status") {
    try {
      const email     = await get("gmail:email");
      const expiresAt = parseInt(await get("gmail:expires_at") || "0");
      return res.json({
        connected:    !!email,
        email:        email || null,
        tokenExpired: expiresAt > 0 && Date.now() > expiresAt,
      });
    } catch (err) {
      return res.json({ connected: false, email: null, tokenExpired: false });
    }
  }

  // ── /api/tracking-stats?ids=... ──────────────────────────────────────
  if (path === "/api/tracking-stats") {
    const { ids } = req.query;
    if (!ids) return res.json({});

    const leadIds = ids.split(",").map(s => s.trim()).filter(Boolean);

    const results = await Promise.all(
      leadIds.map(async (id) => {
        const [opens, clicks] = await Promise.all([
          get(`track:open:${id}`).catch(() => null),
          get(`track:click:${id}`).catch(() => null),
        ]);
        return { id, opens: parseInt(opens) || 0, clicks: parseInt(clicks) || 0 };
      })
    );

    const stats = {};
    results.forEach(({ id, opens, clicks }) => { stats[id] = { opens, clicks }; });
    return res.json(stats);
  }

  res.status(404).json({ error: "Not found" });
};
