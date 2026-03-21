-- ============================================================================
-- Migration: Unified Contracts & Zone Detection by Driving Time
-- Applied: 2026-03-15
-- ============================================================================

-- 1. pricing_zones: add driving-time threshold columns
ALTER TABLE majordhome.pricing_zones
  ADD COLUMN IF NOT EXISTS min_driving_minutes integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_driving_minutes integer DEFAULT NULL;

-- Set driving-time thresholds for existing zones
-- Z1 (Zone 1 - Local): < 30 min from Gaillac
UPDATE majordhome.pricing_zones
  SET min_driving_minutes = 0, max_driving_minutes = 30
  WHERE id = '9950fc9b-101c-4666-b0b2-5ebf85fce6e1';

-- Z2 (Zone 2 - Étendue): 30-60 min from Gaillac
UPDATE majordhome.pricing_zones
  SET min_driving_minutes = 30, max_driving_minutes = 60
  WHERE id = '9aece8ee-8af0-408a-a017-c26fb770cf32';

-- HZ (Hors Zone): >= 60 min from Gaillac
UPDATE majordhome.pricing_zones
  SET min_driving_minutes = 60, max_driving_minutes = 9999
  WHERE id = '60a5db7d-6700-4b7b-a8f7-ed1500da9919';

-- 2. contracts: add source and PDF path columns
ALTER TABLE majordhome.contracts
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS contract_pdf_path text DEFAULT NULL;

-- Comments
COMMENT ON COLUMN majordhome.contracts.source IS 'Origin: app (Majordhome) or web (Landing Page)';
COMMENT ON COLUMN majordhome.contracts.contract_pdf_path IS 'Path in Supabase Storage for the generated contract PDF';
COMMENT ON COLUMN majordhome.pricing_zones.min_driving_minutes IS 'Min driving time in minutes from Gaillac HQ';
COMMENT ON COLUMN majordhome.pricing_zones.max_driving_minutes IS 'Max driving time in minutes from Gaillac HQ';
