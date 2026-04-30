-- SQL Script to Reset Tracking Data
-- Run this in your Neon Postgres console to clear all fake tracking data

-- 1. Clear all tracking counters
TRUNCATE TABLE simple_tracking;

-- 2. Clear all tracking events
TRUNCATE TABLE tracking_events;

-- 3. Verify tables are empty
SELECT COUNT(*) as tracking_count FROM simple_tracking;
SELECT COUNT(*) as events_count FROM tracking_events;

-- Expected result: Both counts should be 0

-- Note: This will reset ALL tracking data
-- Only run this if you want to start fresh with accurate tracking
