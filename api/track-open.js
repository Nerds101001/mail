const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

module.exports = async (req, res) => {
  try {
    // Always return pixel headers first
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const { id, cid } = req.query;

    // Return pixel immediately
    res.send(PIXEL);

    // Do tracking asynchronously after response is sent
    if (id) {
      setImmediate(async () => {
        try {
          const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || 
                     req.headers["x-real-ip"] || 
                     "unknown";
          const ua = req.headers["user-agent"] || "unknown";

          console.log(`🔍 [TRACK OPEN] Lead ID: ${id}, IP: ${ip}, UA: ${ua.substring(0, 50)}...`);

          // Simple database operations using basic SQL
          try {
            const { neon } = require("@neondatabase/serverless");
            const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
            
            // Create tables if they don't exist (simple version)
            await sql`
              CREATE TABLE IF NOT EXISTS simple_tracking (
                lead_id TEXT PRIMARY KEY,
                opens INTEGER DEFAULT 0,
                clicks INTEGER DEFAULT 0,
                last_open BIGINT,
                last_click BIGINT
              )
            `;
            
            // Simple increment operation
            await sql`
              INSERT INTO simple_tracking (lead_id, opens, last_open)
              VALUES (${id}, 1, ${Date.now()})
              ON CONFLICT (lead_id) DO UPDATE
                SET opens = simple_tracking.opens + 1,
                    last_open = ${Date.now()}
            `;
            
            console.log(`✅ [TRACK OPEN SUCCESS] Lead ${id} tracking completed`);

          } catch (dbError) {
            console.error(`❌ [TRACK OPEN DB ERROR] Lead ${id}:`, dbError.message);
          }

        } catch(e) {
          console.error(`❌ [TRACK OPEN CRITICAL] Lead ${id}:`, e.message);
        }
      });
    }

  } catch (error) {
    console.error(`❌ [TRACK OPEN FATAL] Error:`, error.message);
    // If everything fails, still try to return a pixel
    try {
      res.setHeader("Content-Type", "image/gif");
      res.send(PIXEL);
    } catch (e) {
      res.status(500).json({ error: error.message });
    }
  }
};
