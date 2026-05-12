-- Wurm Online Historical Archive - Database Schema
-- Phase 0: Immutable Raw Log Preservation

-- PHILOSOPHICAL CONTEXT:
-- 1. Canonical archival records.
-- 2. Raw uploaded material is append-only and immutable.
-- 3. Interpretation systems must derive from preserved sources, never modify them.

-- Cleanup for re-execution during Phase 0 development (DISABLED TO PREVENT DATA LOSS)
-- DROP TABLE IF EXISTS raw_logs CASCADE;

-- Minimal table for raw log metadata and file pointers
CREATE TABLE raw_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256            TEXT UNIQUE NOT NULL, -- Canonical identifier (full-file hash)
  filename          TEXT NOT NULL,
  
  log_type          TEXT NOT NULL DEFAULT 'trade' 
                    CHECK (log_type IN ('trade', 'ptgl', 'village', 'pm', 'unknown')),
  
  corpus            TEXT CHECK (corpus IN ('NFI', 'SFI', 'unknown')),
  observed_servers  TEXT[], -- Array of server strings found in file (e.g., {'Har', 'Cad'})
  
  created_at        TIMESTAMPTZ DEFAULT now(), -- Record initialization
  uploaded_at       TIMESTAMPTZ DEFAULT now(), -- Physical ingestion timestamp
  
  contributor_alias TEXT,
  browser_timezone  TEXT,
  
  storage_provider  TEXT DEFAULT 'supabase', -- Creates future mirror/migration portability
  storage_key       TEXT NOT NULL, -- Path in object storage
  
  byte_size         BIGINT CHECK (byte_size > 0 AND byte_size < 524288000), -- Max 500MB per fragment
  compressed_size   BIGINT, 
  line_count        INTEGER,
  
  period_year       SMALLINT,
  period_month      SMALLINT,
  first_line_raw    TEXT,
  last_line_raw     TEXT,
  temporal_map      JSONB,        -- Granular daily/hourly activity density
  cluster           TEXT,         -- 'NFI' or 'SFI'
  detected_servers  JSONB,        -- {"Har": 120, "Xan": 40}
  source_sha256     TEXT,         -- Original file hash if split

  -- QUALITY CONTROL
  verification_status TEXT DEFAULT 'pending' 
                      CHECK (verification_status IN ('pending', 'verified', 'rejected')),

  -- HISTORICAL SANITY CHECKS (Plausibility Filters)
  CONSTRAINT historical_plausibility CHECK (
    (corpus = 'SFI' AND (period_year BETWEEN 2009 AND EXTRACT(YEAR FROM now()) + 1 OR period_year IS NULL))
    OR
    (corpus = 'NFI' AND (period_year BETWEEN 2020 AND EXTRACT(YEAR FROM now()) + 1 OR period_year IS NULL))
    OR
    (corpus = 'unknown' OR period_year IS NULL)
  )
);

-- Indexes for performance
CREATE INDEX idx_raw_logs_sha256 ON raw_logs(sha256);
CREATE INDEX idx_raw_logs_cluster_period ON raw_logs(cluster, period_year, period_month);
CREATE INDEX idx_raw_logs_corpus ON raw_logs(corpus);

-- Row Level Security (RLS)
ALTER TABLE raw_logs ENABLE ROW LEVEL SECURITY;

-- IMMUTABILITY POLICIES: Append-only enforcement
CREATE POLICY "Public can view archive metadata" ON raw_logs FOR SELECT USING (true);
CREATE POLICY "Public can contribute to archive" ON raw_logs FOR INSERT WITH CHECK (true);

-- Explicitly deny any modifications or deletions to preserve archival integrity
CREATE POLICY "No updates allowed" ON raw_logs FOR UPDATE USING (false);
CREATE POLICY "No deletes allowed" ON raw_logs FOR DELETE USING (false);

COMMENT ON TABLE raw_logs IS 'Immutable registry of historical Wurm Online logs. Raw files are never modified after ingestion.';
