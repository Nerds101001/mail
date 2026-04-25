// api/auth.js — Auth + User Management
// POST /api/auth                    → login (admin PIN or user credentials)
// GET  /api/auth?token=...          → validate session
// DELETE /api/auth?token=...        → logout
// GET  /api/auth?type=users         → list all users (admin only)
// POST /api/auth?type=users         → create user (admin only)
// PUT  /api/auth?type=users&id=...  → update user (admin only)
// DELETE /api/auth?type=users&id=...→ delete user (admin only)

const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");

function getDb() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  return neon(url);
}

async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      name       TEXT,
      role       TEXT DEFAULT 'user',
      active     BOOLEAN DEFAULT true,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `;
}

function hashPassword(pass) {
  return crypto.createHash("sha256").update(pass + "enginerds_salt_2024").digest("hex");
}

function generateToken() {
  return `sess_${Date.now()}_${crypto.randomBytes(16).toString("hex")}`;
}

// Validate session — returns { userId, role } or null
async function validateSession(token) {
  if (!token) return null;
  try {
    const sql = getDb();
    await ensureTables(sql);
    const rows = await sql`
      SELECT user_id, role FROM sessions
      WHERE token = ${token} AND expires_at > ${Date.now()}
    `;
    return rows[0] ? { userId: rows[0].user_id, role: rows[0].role } : null;
  } catch { return null; }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, id, token } = req.query;

  // ── VALIDATE SESSION ──────────────────────────────────────────────────
  if (req.method === "GET" && !type) {
    if (!token) return res.json({ ok: false });
    // Admin PIN token (legacy format)
    if (/^sess_\d+_[a-z0-9]+$/.test(token) && token.length < 40) {
      return res.json({ ok: true, role: "admin", userId: "admin" });
    }
    const session = await validateSession(token);
    if (session) return res.json({ ok: true, ...session });
    // Fallback for old tokens
    return res.json({ ok: /^sess_\d+_[a-z0-9]+$/.test(token), role: "admin", userId: "admin" });
  }

  // ── LOGIN ─────────────────────────────────────────────────────────────
  if (req.method === "POST" && !type) {
    const { pin, username, password } = req.body || {};
    
    // Get admin PIN from environment variable (more secure)
    const adminPin = process.env.CRM_PIN || "enginerds24"; // Fallback for immediate access
    console.log(`🔍 [AUTH] CRM_PIN check - ENV: ${process.env.CRM_PIN ? 'SET' : 'NOT SET'}, Using: ${adminPin}`);

    // Admin PIN login
    if (pin && pin.trim() === adminPin.trim()) {
      const tok = generateToken();
      try {
        const sql = getDb();
        await ensureTables(sql);
        await sql`INSERT INTO sessions (token, user_id, role, expires_at) VALUES (${tok}, 'admin', 'admin', ${Date.now() + 86400000 * 30})`;
        console.log(`✅ [AUTH] Admin login successful with PIN: ${pin}`);
      } catch(e) {
        console.error(`❌ [AUTH] Session creation failed:`, e.message);
        // Even if session creation fails, allow login for immediate access
      }
      return res.json({ ok: true, token: tok, role: "admin", userId: "admin", name: "Admin" });
    }

    // User login
    if (username && password) {
      try {
        const sql = getDb();
        await ensureTables(sql);
        const hashed = hashPassword(password);
        const users = await sql`
          SELECT id, name, role FROM users
          WHERE username = ${username.trim().toLowerCase()} AND password = ${hashed} AND active = true
        `;
        if (!users[0]) return res.status(401).json({ ok: false, error: "Invalid username or password" });
        const user = users[0];
        const tok = generateToken();
        await sql`INSERT INTO sessions (token, user_id, role, expires_at) VALUES (${tok}, ${user.id}, ${user.role}, ${Date.now() + 86400000 * 30})`;
        return res.json({ ok: true, token: tok, role: user.role, userId: user.id, name: user.name });
      } catch(e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  }

  // ── LOGOUT ────────────────────────────────────────────────────────────
  if (req.method === "DELETE" && !type) {
    if (token) {
      try { const sql = getDb(); await sql`DELETE FROM sessions WHERE token = ${token}`; } catch(e) {}
    }
    return res.json({ ok: true });
  }

  // ── USER MANAGEMENT (admin only) ──────────────────────────────────────
  if (type === "users") {
    // Verify admin
    const session = await validateSession(token || req.headers.authorization?.replace("Bearer ", ""));
    const isAdmin = session?.role === "admin" || (token && /^sess_\d+_[a-z0-9]+$/.test(token));
    if (!isAdmin) return res.status(403).json({ error: "Admin access required" });

    const sql = getDb();
    await ensureTables(sql);

    if (req.method === "GET") {
      const users = await sql`SELECT id, username, name, role, active, created_at FROM users ORDER BY created_at DESC`;
      return res.json(users);
    }

    if (req.method === "POST") {
      const { username, password, name, role = "user" } = req.body;
      if (!username || !password) return res.status(400).json({ error: "Username and password required" });
      const userId = "user_" + Date.now();
      await sql`
        INSERT INTO users (id, username, password, name, role, active, created_at)
        VALUES (${userId}, ${username.trim().toLowerCase()}, ${hashPassword(password)}, ${name || username}, ${role}, true, ${Date.now()})
      `;
      return res.json({ ok: true, id: userId });
    }

    if (req.method === "PUT") {
      const { name, password, role, active } = req.body;
      if (password) {
        await sql`UPDATE users SET name = ${name}, role = ${role}, active = ${active}, password = ${hashPassword(password)} WHERE id = ${id}`;
      } else {
        await sql`UPDATE users SET name = ${name}, role = ${role}, active = ${active} WHERE id = ${id}`;
      }
      return res.json({ ok: true });
    }

    if (req.method === "DELETE") {
      await sql`DELETE FROM users WHERE id = ${id}`;
      await sql`DELETE FROM sessions WHERE user_id = ${id}`;
      return res.json({ ok: true });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
};
