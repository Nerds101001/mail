// api/debug.js — temporary debug endpoint, remove after fixing
const { get, set } = require("./_redis");

module.exports = async (req, res) => {
  if (req.method === "POST") {
    // Test write
    try {
      await set("debug:test", "hello_" + Date.now());
      const val = await get("debug:test");
      return res.json({ writeOk: true, readBack: val });
    } catch(e) {
      return res.json({ writeOk: false, error: e.message });
    }
  }

  // GET — read gmail keys
  try {
    const [email, expiresAt, hasAccess, hasRefresh] = await Promise.all([
      get("gmail:email"),
      get("gmail:expires_at"),
      get("gmail:access_token").then(v => !!v),
      get("gmail:refresh_token").then(v => !!v),
    ]);
    res.json({ email, expiresAt, hasAccessToken: hasAccess, hasRefreshToken: hasRefresh });
  } catch(e) {
    res.json({ error: e.message });
  }
};
