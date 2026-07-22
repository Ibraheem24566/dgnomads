-- Migration 002: add ping-post CRM result tracking to leads
-- Run this against your EXISTING Supabase database (the one already
-- running schema.sql) -- it only adds columns, nothing is dropped.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS sold BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
