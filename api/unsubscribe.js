const { get, set } = require('./_redis');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id, email } = req.query;
  if (!id && !email) {
    return res.status(400).json({ error: 'Missing lead ID or Email' });
  }

  try {
    // 1. Mark as unsubscribed in the common leads list if it exists
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
      }
    }

    // 2. IMPORTANT: Set a permanent global unsubscribe flag for this email
    // This will be checked before EVERY send to prevent re-sending to this user.
    if (email) {
      await set(`unsub:${email}`, 'true');
      console.log(`Global unsubscribe set for: ${email}`);
    } else if (id) {
       // If only ID was provided, we've already marked it in the leads list above, 
       // but we should try to find the email to set the global flag if possible.
       const rawLeadsAgain = await get('crm:leads');
       const leadsAgain = JSON.parse(rawLeadsAgain || '[]');
       const lead = leadsAgain.find(l => l.id === id);
       if (lead && lead.email) {
         await set(`unsub:${lead.email}`, 'true');
       }
    }
    
    // Redirect to success page
    res.redirect('/unsubscribe.html?status=success');
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).json({ error: err.message });
  }
};
