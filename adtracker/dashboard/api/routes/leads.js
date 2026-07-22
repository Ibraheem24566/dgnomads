const express = require("express");
const pool = require("../db");

const router = express.Router();

const EDITABLE_FIELDS = ["status", "value", "notes"];

// GET /api/leads?status=&campaign_id=&from=&to=&search=
router.get("/", async (req, res) => {
  const { status, campaign_id, keyword_id, from, to, search } = req.query;
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`l.status = $${params.length}`);
  }
  if (campaign_id) {
    params.push(campaign_id);
    conditions.push(`l.campaign_id = $${params.length}`);
  }
  if (keyword_id) {
    params.push(keyword_id);
    conditions.push(`l.keyword_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`l.created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`l.created_at <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(l.name ILIKE $${params.length} OR l.email ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `SELECT
         l.id, l.name, l.email, l.phone, l.gclid, l.raw_keyword_text,
         l.match_status, l.status, l.value, l.notes, l.source,
         l.sold, l.rejection_reason,
         l.created_at, l.updated_at,
         c.name AS campaign_name, ag.name AS ad_group_name, k.text AS keyword_text
       FROM leads l
       LEFT JOIN campaigns c ON c.id = l.campaign_id
       LEFT JOIN ad_groups ag ON ag.id = l.ad_group_id
       LEFT JOIN keywords k ON k.id = l.keyword_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch leads:", err);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// PATCH /api/leads/:id  { status?, value?, notes? }
// Only status/value/notes are editable -- everything else (attribution,
// contact info) comes from the sync/webhook and shouldn't be hand-edited.
// Every changed field is logged to lead_edits for audit history.
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const updates = Object.keys(req.body).filter((key) => EDITABLE_FIELDS.includes(key));

  if (updates.length === 0) {
    return res.status(400).json({ error: `No editable fields provided. Allowed: ${EDITABLE_FIELDS.join(", ")}` });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingRows } = await client.query("SELECT * FROM leads WHERE id = $1 FOR UPDATE", [id]);
    if (existingRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Lead not found" });
    }
    const existing = existingRows[0];

    const setClauses = [];
    const params = [];
    for (const field of updates) {
      params.push(req.body[field]);
      setClauses.push(`${field} = $${params.length}`);
    }
    params.push(id);

    const { rows: updatedRows } = await client.query(
      `UPDATE leads SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );

    for (const field of updates) {
      const oldValue = existing[field];
      const newValue = req.body[field];
      if (String(oldValue) !== String(newValue)) {
        await client.query(
          `INSERT INTO lead_edits (lead_id, field_name, old_value, new_value) VALUES ($1, $2, $3, $4)`,
          [id, field, oldValue === null ? null : String(oldValue), newValue === null ? null : String(newValue)]
        );
      }
    }

    await client.query("COMMIT");
    res.json(updatedRows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to update lead:", err);
    res.status(500).json({ error: "Failed to update lead" });
  } finally {
    client.release();
  }
});

// GET /api/leads/:id/history -- audit trail of manual edits
router.get("/:id/history", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT field_name, old_value, new_value, edited_at FROM lead_edits WHERE lead_id = $1 ORDER BY edited_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch lead history:", err);
    res.status(500).json({ error: "Failed to fetch lead history" });
  }
});

// POST /api/leads/sync-status -- bulk status update from external source (Google Sheets, CRM, etc.)
// Matches leads by email or phone and updates status
router.post("/sync-status", async (req, res) => {
  const { leads } = req.body; // Array of { email, phone, status }

  if (!Array.isArray(leads)) {
    return res.status(400).json({ error: "leads must be an array" });
  }

  const STATUS_MAPPING = {
    "open": "new",
    "appointment set": "contacted",
    "pre-sale qualified": "qualified",
    "proposal": "qualified",
    "site assessment": "qualified",
    "closed won": "won",
    "closed lost": "lost"
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let updated = 0;
    let matched = 0;
    const results = [];

    for (const leadData of leads) {
      const { email, phone, status } = leadData;
      
      if (!email && !phone) {
        results.push({ error: "Missing email or phone", data: leadData });
        continue;
      }

      const mappedStatus = STATUS_MAPPING[status.toLowerCase()];
      if (!mappedStatus) {
        results.push({ error: `Unmapped status: ${status}`, data: leadData });
        continue;
      }

      // Match lead by email or phone
      const { rows } = await client.query(
        `SELECT id, status FROM leads 
         WHERE email = $1 OR phone = $2 
         LIMIT 1`,
        [email, phone]
      );

      if (rows.length === 0) {
        results.push({ error: "No matching lead found", data: leadData });
        continue;
      }

      matched++;
      const lead = rows[0];

      // Only update if status changed
      if (lead.status !== mappedStatus) {
        await client.query(
          `UPDATE leads 
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          [mappedStatus, lead.id]
        );

        // Log the change to lead_edits
        await client.query(
          `INSERT INTO lead_edits (lead_id, field_name, old_value, new_value)
           VALUES ($1, 'status', $2, $3)`,
          [lead.id, lead.status, mappedStatus]
        );

        updated++;
        results.push({ success: true, lead_id: lead.id, old_status: lead.status, new_status: mappedStatus });
      } else {
        results.push({ success: true, lead_id: lead.id, unchanged: true });
      }
    }

    await client.query("COMMIT");
    res.json({ matched, updated, results });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to sync status:", err);
    res.status(500).json({ error: "Failed to sync status" });
  } finally {
    client.release();
  }
});

// POST /api/leads/sync-crm -- full CRM sync with all fields from Google Sheets
// Matches leads by email/phone/crm_lead_id and creates or updates with full data
router.post("/sync-crm", async (req, res) => {
  const { leads } = req.body; // Array of full lead objects from CRM

  if (!Array.isArray(leads)) {
    return res.status(400).json({ error: "leads must be an array" });
  }

  const STATUS_MAPPING = {
    "open": "new",
    "appointment set": "contacted",
    "pre-sale qualified": "qualified",
    "proposal": "qualified",
    "site assessment": "qualified",
    "closed won": "won",
    "closed lost": "lost"
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let updated = 0;
    let created = 0;
    let matched = 0;
    const results = [];

    for (const leadData of leads) {
      const {
        crm_lead_id,
        first_name,
        last_name,
        email,
        phone,
        created_date,
        lead_source,
        last_modified_date,
        status,
        disqualified_reason,
        outbound_calls,
        converted,
        converted_date,
        opportunity_name,
        stage,
        closed_lost_reason,
        full_address,
        zip_code,
        web_source_campaign
      } = leadData;

      if (!email && !phone) {
        results.push({ error: "Missing email or phone", data: leadData });
        continue;
      }

      const mappedStatus = STATUS_MAPPING[status?.toLowerCase()] || "new";

      // Try to match by crm_lead_id first, then email/phone
      let { rows } = await client.query(
        `SELECT id, status FROM leads 
         WHERE crm_lead_id = $1 
         LIMIT 1`,
        [crm_lead_id]
      );

      if (rows.length === 0) {
        // Try email/phone match
        rows = await client.query(
          `SELECT id, status FROM leads 
           WHERE email = $1 OR phone = $2 
           LIMIT 1`,
          [email, phone]
        );
      }

      if (rows.length === 0) {
        // Create new lead
        const name = [first_name, last_name].filter(Boolean).join(' ') || null;
        const { rows: newLead } = await client.query(
          `INSERT INTO leads (name, first_name, last_name, email, phone, full_address, zip_code,
             lead_source, stage, opportunity_name, converted, converted_date, outbound_calls,
             disqualified_reason, closed_lost_reason, web_source_campaign, status, source, crm_lead_id,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
           RETURNING id`,
          [
            name, first_name, last_name, email, phone, full_address, zip_code,
            lead_source, stage, opportunity_name, 
            converted === true || converted === 'Yes' || converted === 'TRUE',
            converted_date || null,
            parseInt(outbound_calls) || 0,
            disqualified_reason, closed_lost_reason, web_source_campaign,
            mappedStatus, 'crm_sync', crm_lead_id,
            created_date || new Date().toISOString(),
            last_modified_date || new Date().toISOString()
          ]
        );
        created++;
        results.push({ success: true, lead_id: newLead[0].id, action: 'created' });
      } else {
        // Update existing lead
        const lead = rows[0];
        const name = [first_name, last_name].filter(Boolean).join(' ') || lead.name;
        
        await client.query(
          `UPDATE leads 
           SET name = $1, first_name = $2, last_name = $3, email = $4, phone = $5, full_address = $6, zip_code = $7,
              lead_source = $8, stage = $9, opportunity_name = $10, converted = $11, converted_date = $12, 
              outbound_calls = $13, disqualified_reason = $14, closed_lost_reason = $15, 
              web_source_campaign = $16, status = $17, crm_lead_id = $18, updated_at = $19
           WHERE id = $20`,
          [
            name, first_name, last_name, email, phone, full_address, zip_code,
            lead_source, stage, opportunity_name,
            converted === true || converted === 'Yes' || converted === 'TRUE',
            converted_date || null,
            parseInt(outbound_calls) || 0,
            disqualified_reason, closed_lost_reason, web_source_campaign,
            mappedStatus, crm_lead_id, last_modified_date || new Date().toISOString(),
            lead.id
          ]
        );

        // Log status change if different
        if (lead.status !== mappedStatus) {
          await client.query(
            `INSERT INTO lead_edits (lead_id, field_name, old_value, new_value)
             VALUES ($1, 'status', $2, $3)`,
            [lead.id, lead.status, mappedStatus]
          );
        }

        updated++;
        results.push({ success: true, lead_id: lead.id, action: 'updated' });
      }
      matched++;
    }

    await client.query("COMMIT");
    res.json({ matched, updated, created, results });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to sync CRM data:", err);
    res.status(500).json({ error: "Failed to sync CRM data" });
  } finally {
    client.release();
  }
});

module.exports = router;
