// Simple test seeder
const { neon } = require("@neondatabase/serverless");

module.exports = async (req, res) => {
  try {
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    // Test database connection
    const result = await sql`SELECT COUNT(*) as count FROM campaigns`;
    
    res.json({
      success: true,
      message: "Database connection working",
      existing_campaigns: result[0].count,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};