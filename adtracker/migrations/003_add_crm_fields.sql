-- Add CRM fields to leads table
ALTER TABLE leads 
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS full_address TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT,
  ADD COLUMN IF NOT EXISTS web_source_campaign TEXT,
  ADD COLUMN IF NOT EXISTS lead_source TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS opportunity_name TEXT,
  ADD COLUMN IF NOT EXISTS converted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS converted_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outbound_calls INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disqualified_reason TEXT,
  ADD COLUMN IF NOT EXISTS closed_lost_reason TEXT,
  ADD COLUMN IF NOT EXISTS crm_lead_id TEXT;

-- Update existing source values to valid ones before adding constraint
UPDATE leads SET source = 'api' WHERE source NOT IN ('api', 'manual', 'crm_sync', 'google_ads');

-- Update source type to include crm_sync
ALTER TABLE leads 
  ALTER COLUMN source DROP DEFAULT,
  ALTER COLUMN source SET DEFAULT 'api',
  ADD CONSTRAINT check_source CHECK (source IN ('api', 'manual', 'crm_sync', 'google_ads'));
