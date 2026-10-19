// api/unsubscribe.js — the footer "Unsubscribe" link of emails sent BEFORE it was removed from new
// emails. Uses the same single opt-out as the "Not Interested" button (see _optout.js).
const { optOut } = require('./_optout');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id, email } = req.query;
  if (!id && !email) {
    return res.status(400).json({ error: 'Missing lead ID or Email' });
  }

  try {
    await optOut({ email: email || undefined, leadId: id || undefined, source: 'unsubscribe-link' });
    // Redirect to success page
    res.redirect('/unsubscribe.html?status=success');
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).json({ error: err.message });
  }
};
