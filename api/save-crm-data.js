// api/save-crm-data.js
const { set } = require("./_redis");

function sanitizeProfiles(profiles) {
  if (!Array.isArray(profiles)) return profiles;
  return profiles.map(p => {
    if (p.type === "smtp") { const { pass, ...safe } = p; return { ...safe, hasPass: !!pass }; }
    return p;
  });
}

async function safeSet(key, value) {
  try { await set(key, JSON.stringify(value)); } catch(e) { /* Redis unavailable locally — ignore */ }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { leads, profiles, settings, activity, clients, deals } = req.body;
  try {
    await Promise.all([
      leads    !== undefined ? safeSet("crm:leads",    leads)                        : null,
      profiles !== undefined ? safeSet("crm:profiles", sanitizeProfiles(profiles))   : null,
      settings !== undefined ? safeSet("crm:settings", (({openaiKey,...s})=>s)(settings||{})) : null,
      activity !== undefined ? safeSet("crm:activity", activity)                     : null,
      clients  !== undefined ? safeSet("crm:clients",  clients)                      : null,
      deals    !== undefined ? safeSet("crm:deals",    deals)                        : null,
    ].filter(Boolean));
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
