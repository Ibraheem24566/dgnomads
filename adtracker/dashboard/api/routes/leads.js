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

module.exports = router;
