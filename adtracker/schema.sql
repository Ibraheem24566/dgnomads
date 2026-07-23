-- =========================================================
-- Ad Tracking Platform — Database Schema (PostgreSQL)
-- =========================================================

-- ---------------------------------------------------------
-- 1. Google Ads structure (synced FROM Google Ads API)
-- These mirror the campaign > ad group > keyword hierarchy
-- so performance stats and leads can be joined to real names.
-- ---------------------------------------------------------

CREATE TABLE campaigns (
    id              BIGINT PRIMARY KEY,        -- Google Ads campaign ID
    name            TEXT NOT NULL,
    status          TEXT,                      -- ENABLED / PAUSED / REMOVED
    channel_type    TEXT,                      -- SEARCH / DISPLAY / etc
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ad_groups (
    id              BIGINT PRIMARY KEY,        -- Google Ads ad group ID
    campaign_id     BIGINT NOT NULL REFERENCES campaigns(id),
    name            TEXT NOT NULL,
    status          TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE keywords (
    id              BIGINT PRIMARY KEY,        -- Google Ads criterion ID
    ad_group_id     BIGINT NOT NULL REFERENCES ad_groups(id),
    text            TEXT NOT NULL,
    match_type      TEXT,                      -- EXACT / PHRASE / BROAD
    status          TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 2. Daily performance stats (synced FROM Google Ads API)
-- One row per keyword per day. This is where impressions,
-- clicks, cost, and Google-reported conversions live.
-- ---------------------------------------------------------

CREATE TABLE daily_stats (
    id              BIGSERIAL PRIMARY KEY,
    date            DATE NOT NULL,
    campaign_id     BIGINT NOT NULL REFERENCES campaigns(id),
    ad_group_id     BIGINT NOT NULL REFERENCES ad_groups(id),
    keyword_id      BIGINT NOT NULL REFERENCES keywords(id),

    -- core volume/cost metrics (raw, from Google Ads API)
    impressions             INTEGER NOT NULL DEFAULT 0,
    clicks                  INTEGER NOT NULL DEFAULT 0,
    cost_micros             BIGINT NOT NULL DEFAULT 0,   -- 1,000,000 = $1
    conversions              NUMERIC(10,2) NOT NULL DEFAULT 0,  -- Google's primary conversion action(s)
    all_conversions          NUMERIC(10,2) NOT NULL DEFAULT 0,  -- includes cross-device / secondary actions
    view_through_conversions INTEGER NOT NULL DEFAULT 0,

    -- impression share metrics (these come directly from Google,
    -- they can't be derived from clicks/impressions since they're
    -- based on Google's estimate of *eligible* impressions)
    search_impression_share          NUMERIC(5,2),  -- % of eligible impressions you actually got
    search_budget_lost_impr_share    NUMERIC(5,2),  -- % lost due to budget constraints
    search_rank_lost_impr_share      NUMERIC(5,2),  -- % lost due to poor ad rank
    search_top_impression_share      NUMERIC(5,2),  -- % of impressions shown above organic results
    search_abs_top_impression_share  NUMERIC(5,2),  -- % shown in the very top position

    -- quality score (Google Ads reports this per keyword; snapshotted daily since it can shift)
    quality_score           SMALLINT,  -- 1-10 scale

    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (date, keyword_id),                   -- one row per keyword per day, sync upserts into this

    -- generated ratio columns: always derived from the raw numbers above,
    -- so they can never drift out of sync with the source data
    ctr                 NUMERIC(6,4) GENERATED ALWAYS AS (
                            CASE WHEN impressions > 0 THEN clicks::NUMERIC / impressions ELSE 0 END
                        ) STORED,
    average_cpc_micros  BIGINT GENERATED ALWAYS AS (
                            CASE WHEN clicks > 0 THEN cost_micros / clicks ELSE 0 END
                        ) STORED,
    conversion_rate     NUMERIC(6,4) GENERATED ALWAYS AS (
                            CASE WHEN clicks > 0 THEN conversions / clicks ELSE 0 END
                        ) STORED,
    cost_per_conversion_micros BIGINT GENERATED ALWAYS AS (
                            CASE WHEN conversions > 0 THEN (cost_micros / conversions)::BIGINT ELSE 0 END
                        ) STORED
);

CREATE INDEX idx_daily_stats_date ON daily_stats(date);
CREATE INDEX idx_daily_stats_campaign ON daily_stats(campaign_id);

-- ---------------------------------------------------------
-- 3. Leads (captured from your site/CRM via webhook/API)
-- gclid is the bridge that lets us resolve which keyword
-- a lead came from. utm_* fields are a fallback in case
-- gclid matching fails or the lead came from a non-ad source.
-- ---------------------------------------------------------

CREATE TABLE leads (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT,
    first_name      TEXT,
    last_name       TEXT,
    email           TEXT,
    phone           TEXT,
    full_address    TEXT,
    zip_code        TEXT,

    -- attribution raw inputs
    gclid           TEXT,
    utm_source      TEXT,
    utm_medium      TEXT,
    utm_campaign    TEXT,
    utm_term        TEXT,
    landing_page    TEXT,
    raw_keyword_text TEXT,   -- literal keyword text from ValueTrack {keyword}, kept even if matching fails, for debugging
    web_source_campaign TEXT, -- from CRM: Web Source & Campaign

    -- resolved attribution (filled in at ingest time by matching
    -- campaign_id + ad_group_id + keyword text against the synced
    -- `keywords` table -- see webhook resolver, no click_view needed
    -- since ValueTrack params already carry this at click time)
    campaign_id     BIGINT REFERENCES campaigns(id),
    ad_group_id     BIGINT REFERENCES ad_groups(id),
    keyword_id      BIGINT REFERENCES keywords(id),
    match_status    TEXT NOT NULL DEFAULT 'unmatched',
        -- 'matched'          -> resolved to a keyword_id successfully
        -- 'no_match'         -> had campaign/ad group/keyword params but no matching synced row (e.g. sync hasn't caught up yet)
        -- 'no_tracking_data' -> lead had no attribution params at all
        -- 'manual'           -> attribution set by hand in the dashboard

    -- CRM-style fields, editable in the dashboard
    status          TEXT NOT NULL DEFAULT 'new',
        -- 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
        -- Mapped from external CRM: Open→new, appointment set→contacted, 
        -- pre-sale qualified→qualified, proposal→qualified, site assessment→qualified,
        -- closed won→won, closed lost→lost
    lead_source     TEXT,                    -- from CRM: Lead Source
    stage           TEXT,                    -- from CRM: Stage
    opportunity_name TEXT,                  -- from CRM: Opportunity Name
    converted       BOOLEAN DEFAULT FALSE,  -- from CRM: Converted
    converted_date  TIMESTAMPTZ,            -- from CRM: Converted Date
    outbound_calls  INTEGER DEFAULT 0,       -- from CRM: Number of Outbound Calls
    disqualified_reason TEXT,               -- from CRM: Disqualified Reason
    closed_lost_reason TEXT,                -- from CRM: Closed Lost Reason
    
    value           NUMERIC(12,2),              -- deal value, editable
    notes           TEXT,

    source          TEXT NOT NULL DEFAULT 'api', -- 'api' | 'manual' | 'crm_sync'
    crm_lead_id     TEXT,                    -- External CRM lead ID for deduplication

    -- ping-post CRM result, filled in by a second call after your CRM
    -- responds (see /api/leads/crm-result on the webhook). NULL means
    -- "not yet known" -- distinct from false, which means "rejected".
    sold             BOOLEAN,
    rejection_reason TEXT,   -- e.g. 'LEAD_ALREADY_SOLD', 'PUBLISHER_NOT_ALLOWED', 'INACTIVE'

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_gclid ON leads(gclid);
CREATE INDEX idx_leads_keyword ON leads(keyword_id);
CREATE INDEX idx_leads_created_at ON leads(created_at);

-- ---------------------------------------------------------
-- 6. GCLID mappings for keyword attribution
-- Stores the relationship between gclid and keyword_id
-- ---------------------------------------------------------

CREATE TABLE gclid_mappings (
    id              BIGSERIAL PRIMARY KEY,
    gclid           TEXT NOT NULL,
    keyword_id      BIGINT NOT NULL REFERENCES keywords(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gclid_mappings_gclid ON gclid_mappings(gclid);
CREATE INDEX idx_gclid_mappings_keyword ON gclid_mappings(keyword_id);

-- ---------------------------------------------------------
-- 4. Audit log for manual edits made in the dashboard
-- Keeps synced data trustworthy by tracking human overrides
-- separately from what came in automatically.
-- ---------------------------------------------------------

CREATE TABLE lead_edits (
    id              BIGSERIAL PRIMARY KEY,
    lead_id         BIGINT NOT NULL REFERENCES leads(id),
    field_name      TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    edited_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 5. Auto-update `updated_at` on leads
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
