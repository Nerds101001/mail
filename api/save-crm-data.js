// api/save-crm-data.js
const { set } = require('./_redis');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { leads, profiles, settings, activity } = req.body;
  
  try {
    if (leads) await set('crm:leads', JSON.stringify(leads));
    if (profiles) await set('crm:profiles', JSON.stringify(profiles));
    if (settings) await set('crm:settings', JSON.stringify(settings));
    if (activity) await set('crm:activity', JSON.stringify(activity));

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
