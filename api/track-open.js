const { incr, logEvent } = require("./_redis");

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

          // Use simplified tracking system with proper error handling
          try {
            const openCount = await incr(`track:open:${id}`);
            console.log(`✅ [TRACK OPEN] Incr successful - Lead ${id}, Count: ${openCount}`);
          } catch (incrError) {
            console.error(`❌ [TRACK OPEN] Incr failed for ${id}:`, incrError.message, incrError.stack);
          }
          
          try {
            await logEvent({ 
              lead_id: id, 
              event_type: "open", 
              ip, 
              user_agent: ua 
            });
            console.log(`✅ [TRACK OPEN] LogEvent successful for ${id}`);
          } catch (logError) {
            console.error(`❌ [TRACK OPEN] LogEvent failed for ${id}:`, logError.message);
          }

          console.log(`✅ [TRACK OPEN SUCCESS] Lead ${id} tracking completed`);

        } catch(e) {
          console.error(`❌ [TRACK OPEN ERROR] Lead ${id}:`, e.message, e.stack);
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
