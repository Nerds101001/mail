// api/tracking.js — Main tracking router
// Routes tracking requests to appropriate handlers based on type parameter

module.exports = async (req, res) => {
  const { type, id, cid, url } = req.query;

  // Handle different tracking types
  switch (type) {
    case 'open':
      // Route to track-open handler
      const trackOpen = require('./track-open');
      return trackOpen(req, res);
      
    case 'click':
      // Route to track-click handler  
      const trackClick = require('./track-click');
      return trackClick(req, res);
      
    case 'pixel':
      // Route to track-pixel handler
      const trackPixel = require('./track-pixel');
      return trackPixel(req, res);
      
    default:
      // Invalid or missing type parameter
      console.error(`❌ [TRACKING] Invalid type: ${type}`);
      return res.status(400).json({ error: 'Invalid tracking type' });
  }
};