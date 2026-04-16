// api/auth.js — Team PIN login with Redis session (falls back gracefully if Redis unavailable)
const { set, get, del } = require("./_redis");

const PIN = process.env.CRM_PIN || "enginerds2024";

// Try Redis, but don't crash if unavailable (local dev without network)
async function trySet(key, val, ex) { try { await set(key, val, ex); } catch(e) {} }
async function tryGet(key)          { try { return await get(key); } catch(e) { return null; } }
async function tryDel(key)          { try { await del(key); } catch(e) {} }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  // POST — login
  if (req.method === "POST") {
    const { pin } = req.body || {};
    if (!pin || pin !== PIN)
      return res.status(401).json({ ok: false, error: "Invalid PIN" });

    const token = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await trySet(`session:${token}`, "1", 86400 * 7);
    return res.json({ ok: true, token });
  }

  // GET — validate session token
  if (req.method === "GET") {
    const token = req.query.token;
    if (!token) return res.json({ ok: false });
    // If Redis is down, trust any token that looks valid (local dev)
    const valid = await tryGet(`session:${token}`);
    // valid===null means Redis unreachable — allow if token format is correct
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
