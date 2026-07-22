const express = require("express");
const pool = require("../db");

const router = express.Router();

// Thresholds for alerts -- reasonable defaults, adjust to your account size.
const WASTED_SPEND_MIN_COST = 20; // dollars spent with zero matched leads before flagging
const HIGH_COST_PER_LEAD_MULTIPLIER = 2; // flag keywords costing 2x+ the account average
const IMPRESSION_SHARE_LOST_THRESHOLD = 20; // percent lost to budget before flagging

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function getPeriodTotals(from, to) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(ds.impressions), 0) AS impressions,
       COALESCE(SUM(ds.clicks), 0) AS clicks,
       COALESCE(SUM(ds.cost_micros), 0) AS cost_micros,
       COALESCE(SUM(ds.conversions), 0) AS conversions
     FROM daily_stats ds
     WHERE ds.date BETWEEN $1 AND $2`,
    [from, to]
  );

  const { rows: leadRows } = await pool.query(
    `SELECT
       COUNT(*) AS total_leads,
       COUNT(*) FILTER (WHERE sold = true) AS sold_leads,
       COUNT(*) FILTER (WHERE sold = false) AS rejected_leads
     FROM leads
     WHERE created_at::date BETWEEN $1 AND $2`,
    [from, to]
  );

  const stats = rows[0];
  const leads = leadRows[0];
  const cost = Number(stats.cost_micros) / 1_000_000;
  const totalLeads = Number(leads.total_leads);

  return {
    impressions: Number(stats.impressions),
    clicks: Number(stats.clicks),
    cost,
    conversions: Number(stats.conversions),
    total_leads: totalLeads,
    sold_leads: Number(leads.sold_leads),
    rejected_leads: Number(leads.rejected_leads),
    cost_per_lead: totalLeads > 0 ? cost / totalLeads : null,
  };
}

async function getTrend(from, to) {
  const { rows } = await pool.query(
    `SELECT
       ds.date,
       SUM(ds.cost_micros) AS cost_micros,
       SUM(ds.clicks) AS clicks,
       COALESCE(lc.lead_count, 0) AS lead_count
     FROM daily_stats ds
     LEFT JOIN (
       SELECT created_at::date AS d, COUNT(*) AS lead_count
       FROM leads WHERE created_at::date BETWEEN $1 AND $2
       GROUP BY created_at::date
     ) lc ON lc.d = ds.date
     WHERE ds.date BETWEEN $1 AND $2
     GROUP BY ds.date, lc.lead_count
     ORDER BY ds.date ASC`,
    [from, to]
  );

  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    cost: Number(r.cost_micros) / 1_000_000,
    clicks: Number(r.clicks),
    leads: Number(r.lead_count),
  }));
}

async function getAlerts(from, to) {
  const alerts = [];

  // Wasted spend: real cost, zero matched leads
  const { rows: wasted } = await pool.query(
    `SELECT k.id AS keyword_id, k.text AS keyword_text, c.name AS campaign_name, SUM(ds.cost_micros) AS cost_micros
     FROM daily_stats ds
     JOIN keywords k ON k.id = ds.keyword_id
     JOIN campaigns c ON c.id = ds.campaign_id
     LEFT JOIN leads l ON l.keyword_id = ds.keyword_id AND l.created_at::date BETWEEN $1 AND $2
     WHERE ds.date BETWEEN $1 AND $2
     GROUP BY k.id, k.text, c.name
     HAVING SUM(ds.cost_micros) / 1000000.0 > $3 AND COUNT(l.id) = 0
     ORDER BY SUM(ds.cost_micros) DESC
     LIMIT 10`,
    [from, to, WASTED_SPEND_MIN_COST]
  );
  wasted.forEach((r) =>
    alerts.push({
      type: "wasted_spend",
      severity: "high",
      keyword_id: r.keyword_id,
      keyword_text: r.keyword_text,
      campaign_name: r.campaign_name,
      message: `Spent $${(Number(r.cost_micros) / 1_000_000).toFixed(2)} with zero matched leads`,
    })
  );

  // High cost-per-lead outliers vs account average
  const { rows: avgRow } = await pool.query(
    `SELECT
       SUM(ds.cost_micros) / NULLIF(COUNT(DISTINCT l.id), 0) AS avg_cost_per_lead_micros
     FROM daily_stats ds
     LEFT JOIN leads l ON l.keyword_id = ds.keyword_id AND l.created_at::date BETWEEN $1 AND $2
     WHERE ds.date BETWEEN $1 AND $2`,
    [from, to]
  );
  const avgCostPerLead = avgRow[0].avg_cost_per_lead_micros
    ? Number(avgRow[0].avg_cost_per_lead_micros) / 1_000_000
    : null;

  if (avgCostPerLead) {
    const { rows: expensive } = await pool.query(
      `SELECT k.id AS keyword_id, k.text AS keyword_text, c.name AS campaign_name,
              SUM(ds.cost_micros) AS cost_micros, COUNT(DISTINCT l.id) AS lead_count
       FROM daily_stats ds
       JOIN keywords k ON k.id = ds.keyword_id
       JOIN campaigns c ON c.id = ds.campaign_id
       LEFT JOIN leads l ON l.keyword_id = ds.keyword_id AND l.created_at::date BETWEEN $1 AND $2
       WHERE ds.date BETWEEN $1 AND $2
       GROUP BY k.id, k.text, c.name
       HAVING COUNT(DISTINCT l.id) > 0
          AND (SUM(ds.cost_micros) / 1000000.0 / COUNT(DISTINCT l.id)) > $3
       ORDER BY (SUM(ds.cost_micros)::float / COUNT(DISTINCT l.id)) DESC
       LIMIT 10`,
      [from, to, avgCostPerLead * HIGH_COST_PER_LEAD_MULTIPLIER]
    );
    expensive.forEach((r) => {
      const cpl = Number(r.cost_micros) / 1_000_000 / Number(r.lead_count);
      alerts.push({
        type: "high_cost_per_lead",
        severity: "medium",
        keyword_id: r.keyword_id,
      keyword_text: r.keyword_text,
        campaign_name: r.campaign_name,
        message: `Cost per lead is $${cpl.toFixed(2)}, vs account average of $${avgCostPerLead.toFixed(2)}`,
      });
    });
  }

  // Impression share lost to budget
  const { rows: budgetLost } = await pool.query(
    `SELECT k.id AS keyword_id, k.text AS keyword_text, c.name AS campaign_name,
            AVG(ds.search_budget_lost_impr_share) AS avg_lost
     FROM daily_stats ds
     JOIN keywords k ON k.id = ds.keyword_id
     JOIN campaigns c ON c.id = ds.campaign_id
     WHERE ds.date BETWEEN $1 AND $2 AND ds.search_budget_lost_impr_share IS NOT NULL
     GROUP BY k.id, k.text, c.name
     HAVING AVG(ds.search_budget_lost_impr_share) > $3
     ORDER BY AVG(ds.search_budget_lost_impr_share) DESC
     LIMIT 10`,
    [from, to, IMPRESSION_SHARE_LOST_THRESHOLD]
  );
  budgetLost.forEach((r) =>
    alerts.push({
      type: "budget_lost_impression_share",
      severity: "medium",
      keyword_id: r.keyword_id,
      keyword_text: r.keyword_text,
      campaign_name: r.campaign_name,
      message: `Losing ${Number(r.avg_lost).toFixed(1)}% of impressions to budget constraints`,
    })
  );

  return alerts;
}

async function getRejectionInsight(from, to) {
  const { rows: breakdown } = await pool.query(
    `SELECT rejection_reason, COUNT(*) AS count
     FROM leads
     WHERE sold = false AND rejection_reason IS NOT NULL
       AND created_at::date BETWEEN $1 AND $2
     GROUP BY rejection_reason
     ORDER BY count DESC`,
    [from, to]
  );

  const { rows: byKeyword } = await pool.query(
    `SELECT k.id AS keyword_id, k.text AS keyword_text, c.name AS campaign_name,
            COUNT(*) FILTER (WHERE l.sold = true) AS sold_count,
            COUNT(*) FILTER (WHERE l.sold = false) AS rejected_count
     FROM leads l
     JOIN keywords k ON k.id = l.keyword_id
     JOIN campaigns c ON c.id = l.campaign_id
     WHERE l.created_at::date BETWEEN $1 AND $2 AND l.sold IS NOT NULL
     GROUP BY k.id, k.text, c.name
     HAVING COUNT(*) FILTER (WHERE l.sold = false) > 0
     ORDER BY COUNT(*) FILTER (WHERE l.sold = false) DESC
     LIMIT 10`,
    [from, to]
  );

  return {
    breakdown: breakdown.map((r) => ({ reason: r.rejection_reason, count: Number(r.count) })),
    by_keyword: byKeyword.map((r) => ({
      keyword_id: r.keyword_id,
      keyword_text: r.keyword_text,
      campaign_name: r.campaign_name,
      sold_count: Number(r.sold_count),
      rejected_count: Number(r.rejected_count),
    })),
  };
}

// GET /api/overview?days=7
router.get("/", async (req, res) => {
  const days = parseInt(req.query.days, 10) || 7;
  const currentFrom = dateNDaysAgo(days - 1);
  const currentTo = dateNDaysAgo(0);
  const previousFrom = dateNDaysAgo(days * 2 - 1);
  const previousTo = dateNDaysAgo(days);

  try {
    const [current, previous, trend, alerts, rejectionInsight] = await Promise.all([
      getPeriodTotals(currentFrom, currentTo),
      getPeriodTotals(previousFrom, previousTo),
      getTrend(currentFrom, currentTo),
      getAlerts(currentFrom, currentTo),
      getRejectionInsight(currentFrom, currentTo),
    ]);

    res.json({
      period: { from: currentFrom, to: currentTo, days },
      current,
      previous,
      trend,
      alerts,
      rejection_insight: rejectionInsight,
    });
  } catch (err) {
    console.error("Failed to build overview:", err);
    res.status(500).json({ error: "Failed to build overview" });
  }
});

module.exports = router;
