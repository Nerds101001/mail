// api/auth.js — Team PIN login
const { set, get, del } = require("./_redis");

async function trySet(key, val, ex) { try { await set(key, val, ex); } catch(e) {} }
async function tryGet(key)          { try { return await get(key); } catch(e) { return null; } }
async function tryDel(key)          { try { await del(key); } catch(e) {} }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  // POST — login
  if (req.method === "POST") {
    // Read PIN fresh on every request — avoids module-load-time env var issues
    const PIN = (process.env.CRM_PIN || "enginerds2024").trim();
    const { pin } = req.body || {};
    const submitted = (pin || "").trim();

    if (!submitted || submitted !== PIN)
      return res.status(401).json({ ok: false, error: "Invalid PIN", debug: `expected length ${PIN.length}, got length ${submitted.length}` });

    const token = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await trySet(`session:${token}`, "1", 86400 * 7);
    return res.json({ ok: true, token });
  }

  // GET — validate session
  if (req.method === "GET") {
    const token = req.query.token;
    if (!token) return res.json({ ok: false });
    const valid = await tryGet(`session:${token}`);
    const tokenLooksValid = /^sess_\d+_[a-z0-9]+$/.test(token);
    return res.json({ ok: valid === "1" || (valid === null && tokenLooksValid) });
  }

  // DELETE — logout
  if (req.method === "DELETE") {
    const token = req.query.token;
    if (token) await tryDel(`session:${token}`);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
};
