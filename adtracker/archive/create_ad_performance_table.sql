-- Run this SQL to create the table
CREATE TABLE IF NOT EXISTS ad_performance (
  id SERIAL PRIMARY KEY,
  campaign_name TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(campaign_name, date)
);