// api/validate.js
// Advanced email validation: MX records, Domain existence, and Blacklist
// Uses Node.js 'dns' module (only available on server)

const dns = require('dns').promises;

// Simple static blacklist (would be better with a database or external service)
const BLACKLISTED_DOMAINS = [
  'spam.com',
  'botmail.com',
  'fake-sender.org',
  'scamsite.net'
];

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const domain = email.split('@')[1].toLowerCase();

  try {
    const results = {
      domainExists: false,
      hasMx: false,
      isBlacklisted: BLACKLISTED_DOMAINS.includes(domain),
      status: 'VALID'
    };

    // 11. Blacklist Check
    if (results.isBlacklisted) {
      results.status = 'BLACKLISTED';
      return res.json(results);
    }

    // 7. Invalid Domain Check & 8. MX Record Check
    try {
      // Check for MX records (best way to see if it can receive email)
      const mx = await dns.resolveMx(domain);
      if (mx && mx.length > 0) {
        results.domainExists = true;
        results.hasMx = true;
      }
    } catch (e) {
      // If MX fails, try resolving any record to see if domain exists at all
      try {
        await dns.resolve(domain);
        results.domainExists = true;
        results.hasMx = false; // Exists but no mail server
      } catch (e2) {
        results.domainExists = false;
        results.hasMx = false;
      }
    }

    // Final Status mapping
    if (!results.domainExists) {
      results.status = 'INVALID-DOMAIN';
    } else if (!results.hasMx) {
      results.status = 'NO-MAIL-SERVER';
    }

    res.json(results);
  } catch (err) {
    console.error('Validation error:', err);
    res.status(500).json({ error: 'Server error during validation' });
  }
};
