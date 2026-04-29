// Simple test endpoint to verify deployment
module.exports = async (req, res) => {
  res.json({
    success: true,
    message: "Deployment is working!",
    timestamp: new Date().toISOString(),
    method: req.method,
    files_exist: {
      "generate-ai": "✅ Should be available at /api/generate-ai",
      "seed-demo": "✅ Should be available at /api/seed-demo"
    }
  });
};