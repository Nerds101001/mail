// api/quick-fix-auth.js — Quick auth fix
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  
  if (req.method === "POST") {
    const { pin } = req.body || {};
    
    // Check if CRM_PIN is set
    const adminPin = process.env.CRM_PIN;
    console.log("🔍 [QUICK AUTH] CRM_PIN from env:", adminPin ? "SET" : "NOT SET");
    console.log("🔍 [QUICK AUTH] Received PIN:", pin);
    
    // Hardcoded fallback for immediate access
    if (pin === "enginerds24") {
      const token = `sess_${Date.now()}_quickfix`;
      console.log("✅ [QUICK AUTH] Login successful with hardcoded PIN");
      return res.json({ 
        ok: true, 
        token, 
        role: "admin", 
        userId: "admin", 
        name: "Admin",
        message: "Quick fix auth - please set CRM_PIN in Vercel env vars"
      });
    }
    
    return res.status(401).json({ 
      ok: false, 
      error: "Invalid PIN",
      debug: {
        envPinSet: !!adminPin,
        receivedPin: pin
      }
    });
  }
  
  // Validate token (simple check)
  if (req.method === "GET") {
    const { token } = req.query;
    if (token && token.includes("quickfix")) {
      return res.json({ ok: true, role: "admin", userId: "admin" });
    }
    return res.json({ ok: false });
  }
  
  res.status(405).json({ error: "Method not allowed" });
};