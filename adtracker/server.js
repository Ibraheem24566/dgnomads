const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");

const app = express();
app.use(express.json());
app.use(cors());

// Auth middleware for API Key
function requireApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  const expectedKey = process.env.WEBHOOK_API_KEY || "secret";

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
  }
  next();
}

// POST /api/performance/sync -- Ingest Google Ads performance data
app.post("/api/performance/sync", requireApiKey, async (req, res) => {
  const { rows } = req.body;

  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: "Payload must contain an array of rows under the 'rows' field" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const item of rows) {
      const { campaign, ad_group, keyword, stats } = item;

      // 1. Upsert Campaign
      await client.query(
        `INSERT INTO campaigns (id, name, status, channel_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = $2, status = $3, channel_type = $4`,
        [campaign.id, campaign.name, campaign.status, campaign.channel_type]
      );

      // 2. Upsert Ad Group
      await client.query(
        `INSERT INTO ad_groups (id, campaign_id, name, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = $3, status = $4`,
        [ad_group.id, ad_group.campaign_id, ad_group.name, ad_group.status]
      );

      // 3. Upsert Keyword
      await client.query(
        `INSERT INTO keywords (id, ad_group_id, text, match_type, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET text = $3, match_type = $4, status = $5`,
        [keyword.id, keyword.ad_group_id, keyword.text, keyword.match_type, keyword.status]
      );

      // 4. Upsert Daily Stats
      await client.query(
        `INSERT INTO daily_stats (
          date, campaign_id, ad_group_id, keyword_id, impressions, clicks, cost_micros, 
          conversions, all_conversions, view_through_conversions, 
          search_impression_share, search_budget_lost_impr_share, search_rank_lost_impr_share, 
          search_top_impression_share, search_abs_top_impression_share, quality_score
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (date, keyword_id) DO UPDATE SET
           impressions = $5, clicks = $6, cost_micros = $7, conversions = $8,
           all_conversions = $9, view_through_conversions = $10,
           search_impression_share = $11, search_budget_lost_impr_share = $12,
           search_rank_lost_impr_share = $13, search_top_impression_share = $14,
           search_abs_top_impression_share = $15, quality_score = $16`,
        [
          stats.date, stats.campaign_id, stats.ad_group_id, stats.keyword_id,
          stats.impressions, stats.clicks, stats.cost_micros, stats.conversions,
          stats.all_conversions, stats.view_through_conversions,
          stats.search_impression_share, stats.search_budget_lost_impr_share,
          stats.search_rank_lost_impr_share, stats.search_top_impression_share,
          stats.search_abs_top_impression_share, stats.quality_score
        ]
      );
    }

    await client.query("COMMIT");
    res.json({ status: "ok" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Performance sync failed:", err);
    res.status(500).json({ error: "Sync failed" });
  } finally {
    client.release();
  }
});

// POST /api/leads/webhook -- Handle inbound lead with gclid attribution
app.post("/api/leads/webhook", requireApiKey, async (req, res) => {
  const { id, name, email, phone, gclid, raw_keyword_text, utm_source, utm_medium, utm_campaign, utm_term, landing_page } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Attempt to match campaign, ad group, keyword by analyzing our database
    let campaign_id = null;
    let ad_group_id = null;
    let keyword_id = null;
    let match_status = "no_tracking_data";

    if (gclid || raw_keyword_text) {
      match_status = "no_match";
      // Try to find keyword text match in our database
      if (raw_keyword_text) {
        const { rows: matchedKw } = await client.query(
          `SELECT k.id AS keyword_id, ag.id AS ad_group_id, c.id AS campaign_id 
           FROM keywords k
           JOIN ad_groups ag ON ag.id = k.ad_group_id
           JOIN campaigns c ON c.id = ag.campaign_id
           WHERE k.text = $1 LIMIT 1`,
          [raw_keyword_text]
        );
        if (matchedKw.length > 0) {
          keyword_id = matchedKw[0].keyword_id;
          ad_group_id = matchedKw[0].ad_group_id;
          campaign_id = matchedKw[0].campaign_id;
          match_status = "matched";
        }
      }
    }

    await client.query(
      `INSERT INTO leads (name, email, phone, gclid, raw_keyword_text, campaign_id, ad_group_id, keyword_id, match_status, utm_source, utm_medium, utm_campaign, utm_term, landing_page, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'api')`,
      [name, email, phone, gclid, raw_keyword_text, campaign_id, ad_group_id, keyword_id, match_status, utm_source, utm_medium, utm_campaign, utm_term, landing_page]
    );

    await client.query("COMMIT");
    res.json({ status: "ok", match_status });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Lead creation failed:", err);
    res.status(500).json({ error: "Failed to create lead" });
  } finally {
    client.release();
  }
});

// GET /api/leads/public -- Public health/verification check for leads endpoint
app.get("/api/leads/public", (req, res) => {
  res.json({ status: "active" });
});

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

const port = process.env.WEBHOOK_PORT || 3001;
app.listen(port, () => console.log(`Version A Webhook receiver listening on port ${port}`));
