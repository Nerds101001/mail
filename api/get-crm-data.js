// api/get-crm-data.js
const { get } = require('./_redis');

module.exports = async (req, res) => {
  try {
    const leads = await get('crm:leads') || '[]';
    const profiles = await get('crm:profiles') || '[]';
    const settings = await get('crm:settings') || '{}';
    const activity = await get('crm:activity') || '[]';

    res.status(200).json({
      leads: JSON.parse(leads),
      profiles: JSON.parse(profiles),
      settings: JSON.parse(settings),
      activity: JSON.parse(activity)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
