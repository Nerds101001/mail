// api/debug-ops.js — Debug version of ops endpoint
const { getTrackingStats } = require("./_redis");

module.exports = async (req, res) => {
  try {
    console.log("Debug ops called with query:", req.query);
    
    const { type, ids } = req.query;
    
    if (type === "tracking") {
      if (!ids) {
        return res.json({ error: "No ids provided", query: req.query });
      }
      
      const leadIds = ids.split(",").filter(Boolean);
      console.log("Lead IDs:", leadIds);
      
      const stats = await getTrackingStats(leadIds);
      console.log("Stats:", stats);
      
      return res.json({ success: true, stats, leadIds });
    }
    
    return res.json({ error: "Invalid type", query: req.query });
    
  } catch (error) {
    console.error("Debug ops error:", error);
    return res.status(500).json({ 
      error: error.message, 
      stack: error.stack,
      query: req.query 
    });
  }
};