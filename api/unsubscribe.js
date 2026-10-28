// api/unsubscribe.js — the footer "Unsubscribe" link of emails sent BEFORE it was removed from new
// emails. Uses the same single opt-out as the "Not Interested" button (see _optout.js).
//
// Opening the link only shows a confirmation page (so mail scanners that open every link cannot
// unsubscribe anyone); pressing its button POSTs here and the opt-out is made.
// (This used to redirect to /unsubscribe.html, a file that is not part of the deployed site — visitors
// landed on the CRM login screen instead of a confirmation.)
const { optOut } = require('./_optout');
const { confirmPage, donePage, errorPage } = require('./_optoutPages');

module.exports = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query.id ? String(req.query.id) : '';
  const email = req.query.email ? String(req.query.email) : '';
  if (!id && !email) return res.status(400).send(errorPage('This unsubscribe link is incomplete.'));

  // Opening the link: show the page, change nothing.
  if (req.method !== 'POST') {
    const qs = [id && `id=${encodeURIComponent(id)}`, email && `email=${encodeURIComponent(email)}`].filter(Boolean).join('&');
    return res.send(confirmPage({
      title: 'Unsubscribe',
      icon: '✉️',
      heading: 'Unsubscribe from our emails?',
      text: "Press the button and we won't send you any more emails.",
      button: 'Yes, unsubscribe me',
      color: '#475569',
      postTo: `/api/unsubscribe?${qs}`,
    }));
  }

  try {
    await optOut({ email: email || undefined, leadId: id || undefined, source: 'unsubscribe-link' });
    return res.send(donePage({
      title: 'Unsubscribed',
      icon: '✅',
      heading: "You've been unsubscribed",
      text: "You won't receive any more emails from us. We respect your decision.",
    }));
  } catch (err) {
    console.error('Unsubscribe error:', err);
    // optOut throws when it cannot tell who this is → say so instead of a false "unsubscribed"
    return res.status(500).send(errorPage());
  }
};
