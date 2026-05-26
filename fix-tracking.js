// Quick fix script to test and repair tracking
const { neon } = require("@neondatabase/serverless");

async function fixTracking() {
  console.log("🔧 Starting tracking system repair...");
  
  // 1. Check environment variables
  console.log("\n📋 Environment Check:");
  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "✅ Set" : "❌ Missing");
  console.log("POSTGRES_URL:", process.env.POSTGRES_URL ? "✅ Set" : "❌ Missing");
  console.log("APP_URL:", process.env.APP_URL ? "✅ Set" : "❌ Missing");
  
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.log("❌ No database URL found! Set DATABASE_URL or POSTGRES_URL");
    return;
  }
  
  try {
    // 2. Test database connection
    console.log("\n🗄️ Testing database connection...");
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    
    // 3. Create tables if they don't exist
    console.log("📋 Creating tracking tables...");
    
    await sql`
      CREATE TABLE IF NOT EXISTS simple_tracking (
        lead_id TEXT PRIMARY KEY,
        opens INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        last_open BIGINT,
        last_click BIGINT
      )
    `;
    
    await sql`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        lead_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        target_url TEXT,
        created_at BIGINT NOT NULL
      )
    `;
    
    console.log("✅ Tables created successfully");
    
    // 4. Insert test data
    console.log("\n🧪 Inserting test tracking data...");
    
    await sql`
      INSERT INTO simple_tracking (lead_id, opens, clicks, last_open, last_click)
      VALUES ('test_lead_001', 5, 2, ${Date.now()}, ${Date.now()})
      ON CONFLICT (lead_id) DO UPDATE SET
        opens = EXCLUDED.opens,
        clicks = EXCLUDED.clicks,
        last_open = EXCLUDED.last_open,
        last_click = EXCLUDED.last_click
    `;
    
    await sql`
      INSERT INTO tracking_events (lead_id, event_type, ip, user_agent, created_at)
      VALUES 
        ('test_lead_001', 'open', '127.0.0.1', 'Test Browser', ${Date.now()}),
        ('test_lead_001', 'click', '127.0.0.1', 'Test Browser', ${Date.now()})
    `;
    
    console.log("✅ Test data inserted");
    
    // 5. Verify data
    console.log("\n📊 Verifying tracking data...");
    
    const stats = await sql`SELECT * FROM simple_tracking WHERE lead_id = 'test_lead_001'`;
    const events = await sql`SELECT * FROM tracking_events WHERE lead_id = 'test_lead_001' LIMIT 5`;
    
    console.log("Stats:", stats);
    console.log("Events:", events);
    
    console.log("\n✅ Tracking system repair completed!");
    console.log("\n🧪 Next steps:");
    console.log("1. Open mail/debug-tracking.html to test tracking");
    console.log("2. Send a test email and check if tracking works");
    console.log("3. Check Vercel logs for tracking events");
    
  } catch (error) {
    console.error("❌ Tracking repair failed:", error);
    console.error("Stack:", error.stack);
  }
}

// Run if called directly
if (require.main === module) {
  fixTracking();
}

module.exports = { fixTracking };