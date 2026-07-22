const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const pool = require("./db");

const app = express();
app.use(express.json());
app.use(cors());

// Verify Google Ads webhook signature
function verifySignature(req, res, next) {
  const secret = process.env.GOOGLE_ADS_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("GOOGLE_ADS_WEBHOOK_SECRET not set, skipping signature verification");
    return next();
  }

  const signature = req.headers["x-goog-signature"];
  if (!signature) {
    return res.status(401).json({ error: "Missing signature header" });
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (signature !== expectedSignature) {
    console.warn("Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  next();
}

// Helper: find campaign/ad_group/keyword by gclid
async function findAttribution(gclid) {
  if (!gclid) return { campaign_id: null, ad_group_id: null, keyword_id: null, match_status: "no_tracking_data" };

  try {
    const { rows } = await pool.query(
      `SELECT c.id AS campaign_id, ag.id AS ad_group_id, k.id AS keyword_id
       FROM gclid_mappings gm
       JOIN keywords k ON k.id = gm.keyword_id
       JOIN ad_groups ag ON ag.id = k.ad_group_id
       JOIN campaigns c ON c.id = ag.campaign_id
       WHERE gm.gclid = $1
       ORDER BY gm.created_at DESC
       LIMIT 1`,
      [gclid]
    );

    if (rows.length === 0) {
      return { campaign_id: null, ad_group_id: null, keyword_id: null, match_status: "no_match" };
    }

    return { ...rows[0], match_status: "matched" };
  } catch (err) {
    console.error("Attribution lookup failed:", err);
    return { campaign_id: null, ad_group_id: null, keyword_id: null, match_status: "error" };
  }
}

// POST /webhook/google-ads-performance -- Google Ads script performance data
app.post("/webhook/google-ads-performance", async (req, res) => {
  const { secret, data } = req.body;

  if (secret !== process.env.GOOGLE_ADS_WEBHOOK_SECRET) {
    console.log("Received secret:", secret, "Expected:", process.env.GOOGLE_ADS_WEBHOOK_SECRET);
    return res.status(401).json({ error: "Invalid secret" });
  }

  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "Data must be an array" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of data) {
      const { campaign, clicks, cost, impressions, date } = row;
      // Upsert performance data
      await client.query(
        `INSERT INTO ad_performance (campaign_name, clicks, cost, impressions, date)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (campaign_name, date) DO UPDATE 
         SET clicks = $2, cost = $3, impressions = $4`,
        [campaign, clicks, cost, impressions, date]
      );
    }
    await client.query("COMMIT");
    res.json({ status: "ok" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to store performance data:", err);
    res.status(500).json({ error: "Failed to store performance data" });
  } finally {
    client.release();
  }
});

// POST /webhook/google-ads -- Google Ads lead form webhook
app.post("/webhook/google-ads", verifySignature, async (req, res) => {
  const lead = req.body;

  // Expected fields from Google Ads lead form webhook:
  // lead_id, gclid, name, email, phone, raw_keyword_text, form_submission_time, etc.
  const {
    lead_id,
    gclid,
    name,
    email,
    phone,
    raw_keyword_text,
    form_submission_time,
    ...rest
  } = lead;

  if (!lead_id) {
    return res.status(400).json({ error: "Missing lead_id" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check if lead already exists (idempotency)
    const { rows: existing } = await client.query("SELECT id FROM leads WHERE id = $1", [lead_id]);
    if (existing.length > 0) {
      await client.query("COMMIT");
      return res.json({ status: "duplicate", lead_id });
    }

    // Find attribution
    const { campaign_id, ad_group_id, keyword_id, match_status } = await findAttribution(gclid);

    // Insert lead
    await client.query(
      `INSERT INTO leads (id, name, email, phone, gclid, raw_keyword_text, match_status, campaign_id, ad_group_id, keyword_id, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'google_ads', COALESCE($11, NOW()))`,
      [lead_id, name, email, phone, gclid, raw_keyword_text, match_status, campaign_id, ad_group_id, keyword_id, form_submission_time]
    );

    await client.query("COMMIT");
    console.log(`Lead ${lead_id} stored with match_status=${match_status}`);
    res.json({ status: "ok", lead_id, match_status });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to store lead:", err);
    res.status(500).json({ error: "Failed to store lead" });
  } finally {
    client.release();
  }
});

// POST /webhook/generic -- generic webhook for other sources
app.post("/webhook/generic", async (req, res) => {
  const lead = req.body;
  const { lead_id, gclid, name, email, phone, raw_keyword_text, source = "generic", ...rest } = lead;

  if (!lead_id) {
    return res.status(400).json({ error: "Missing lead_id" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query("SELECT id FROM leads WHERE id = $1", [lead_id]);
    if (existing.length > 0) {
      await client.query("COMMIT");
      return res.json({ status: "duplicate", lead_id });
    }

    const { campaign_id, ad_group_id, keyword_id, match_status } = await findAttribution(gclid);

    await client.query(
      `INSERT INTO leads (id, name, email, phone, gclid, raw_keyword_text, match_status, campaign_id, ad_group_id, keyword_id, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [lead_id, name, email, phone, gclid, raw_keyword_text, match_status, campaign_id, ad_group_id, keyword_id, source]
    );

    await client.query("COMMIT");
    res.json({ status: "ok", lead_id, match_status });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to store generic lead:", err);
    res.status(500).json({ error: "Failed to store lead" });
  } finally {
    client.release();
  }
});

// Health check
// --- CRM result callback ---
// Call this right after your ping-post CRM responds to a lead post, so the
// dashboard can show which keywords produce leads that actually get SOLD,
// not just submitted. Match on whichever identifier you have: the lead's
// own id (if you captured it from the /api/leads/webhook response), or
// gclid as a fallback for matching by click id.
app.post("/api/leads/crm-result", async (req, res) => {
  const apiKey = req.header("x-api-key");
  if (apiKey !== process.env.WEBHOOK_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }

  const { lead_id, gclid, sold, rejection_reason } = req.body;
  if (!lead_id && !gclid) {
    return res.status(400).json({ error: "Provide lead_id or gclid to identify the lead" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE leads SET sold = $1, rejection_reason = $2
       WHERE ${lead_id ? "id = $3" : "gclid = $3"}
       RETURNING id`,
      [sold ?? null, rejection_reason ?? null, lead_id || gclid]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "No matching lead found" });
    }
    res.json({ id: rows[0].id, status: "updated" });
  } catch (err) {
    console.error("CRM result update failed:", err);
    res.status(500).json({ error: "Failed to update lead" });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const port = process.env.WEBHOOK_PORT || 3001;
app.listen(port, () => console.log(`Webhook receiver listening on port ${port}`));