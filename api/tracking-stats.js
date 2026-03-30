// api/tracking-stats.js
// Returns open + click counts for a list of lead IDs
// The frontend polls this to update its tracking display
//
// GET /api/tracking-stats?ids=id1,id2,id3
// GET /api/gmail-status  (checks if Gmail is connected)

const { get } = require("./_redis");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── /api/tracking-stats?ids=... ─────────────────────────────────────
  if (req.url.startsWith("/api/tracking-stats")) {
    const { ids } = req.query;

    if (!ids) return res.json({});

    const leadIds = ids.split(",").filter(Boolean);

    // Fetch all open + click counts in parallel
    const results = await Promise.all(
      leadIds.map(async (id) => {
        const [opens, clicks] = await Promise.all([
          get(`track:open:${id}`).catch(() => 0),
          get(`track:click:${id}`).catch(() => 0),
        ]);
        return { id, opens: parseInt(opens) || 0, clicks: parseInt(clicks) || 0 };
      })
    );

    // Return as { leadId: { opens, clicks } }
    const stats = {};
    results.forEach(({ id, opens, clicks }) => {
      stats[id] = { opens, clicks };
    });

    return res.json(stats);
  }

  // ── /api/gmail-status ────────────────────────────────────────────────
  if (req.url.startsWith("/api/gmail-status")) {
    const email = await get("gmail:email").catch(() => null);
    const expiresAt = parseInt(await get("gmail:expires_at").catch(() => "0"));
    return res.json({
      connected: !!email,
      email: email || null,
      tokenExpired: expiresAt > 0 && Date.now() > expiresAt,
    });
  }

  res.status(404).json({ error: "Not found" });
};
