// api/get-crm-data.js
const { get } = require('./_redis');

async function safeGet(key, fallback) {
  try { const v = await get(key); return v ? JSON.parse(v) : fallback; }
  catch(e) { return fallback; }
}

module.exports = async (req, res) => {
  const [leads, profiles, settings, activity, clients, deals] = await Promise.all([
    safeGet('crm:leads',    []),
    safeGet('crm:profiles', []),
    safeGet('crm:settings', {}),
    safeGet('crm:activity', []),
    safeGet('crm:clients',  []),
    safeGet('crm:deals',    []),
  ]);
  res.status(200).json({ leads, profiles, settings, activity, clients, deals });
};
