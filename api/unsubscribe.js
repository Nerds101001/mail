const { get, set } = require('./_redis');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id, email } = req.query;
  if (!id && !email) {
    return res.status(400).json({ error: 'Missing lead ID or Email' });
  }

  try {
    const rawLeads = await get('crm:leads');
    if (rawLeads) {
      let leads = JSON.parse(rawLeads);
      let updated = false;

      leads.forEach(l => {
        if (l.id === id || l.email === email) {
          l.status = 'UNSUBSCRIBED';
          l.notes = (l.notes || '') + `\n[${new Date().toISOString()}] Unsubscribed via Link`;
          updated = true;
        }
      });

      if (updated) {
        await set('crm:leads', JSON.stringify(leads));
        console.log(`Lead ${id || email} unsubscribed`);
      }
    }
    
    // Redirect to a simple confirmation or just return success
    res.redirect('/unsubscribe.html?status=success');
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).json({ error: err.message });
  }
};
