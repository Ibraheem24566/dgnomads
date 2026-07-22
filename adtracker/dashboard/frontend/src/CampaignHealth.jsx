import { useEffect, useState, useCallback } from "react";
import { getPerformance } from "./api";
import Sparkline from "./Sparkline";

const STATUS_COLOR = { excellent: "var(--success)", attention: "var(--warning)", poor: "var(--danger)" };

function fmtMoney(n) { return `$${Number(n).toFixed(2)}`; }
function fmtPct(n) { return `${(Number(n) * 100).toFixed(1)}%`; }

const STATUS_LABEL = { excellent: "Excellent", attention: "Needs attention", poor: "Poor" };

// Classifies a campaign against the account's own averages for this period --
// no hardcoded "good CPL" number, since that varies wildly by business.
function classify(row, accountAvgCpl) {
  if (row.cost > 20 && row.lead_count === 0) return "poor"; // real spend, zero leads
  if (accountAvgCpl && row.cost_per_lead !== null) {
    if (row.cost_per_lead > accountAvgCpl * 1.75) return "poor";
    if (row.cost_per_lead > accountAvgCpl * 1.15) return "attention";
  }
  if (row.avg_impression_share !== null && row.avg_impression_share < 40) return "attention";
  return "excellent";
}

// `rows` is the account's per-campaign performance for the period (already
// fetched once by the parent via getPerformance group_by=campaign), so this
// component only needs to fetch the extra per-day breakdown for sparklines.
export default function CampaignHealth({ rows, from, to, onSelectCampaign }) {
  const [trends, setTrends] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!rows || rows.length === 0) { setLoading(false); return; }
    setLoading(true);
    try {
      const entries = await Promise.all(
        rows.map(async (r) => {
          const daily = await getPerformance({ from, to, group_by: "date", campaign_id: r.campaign_id });
          return [r.campaign_id, daily.map((d) => d.cost)];
        })
      );
      setTrends(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [rows, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return <div className="loading">Loading campaign health…</div>;
  if (rows.length === 0) return null;

  const withLeads = rows.filter((r) => r.lead_count > 0 && r.cost_per_lead !== null);
  const accountAvgCpl = withLeads.length
    ? withLeads.reduce((s, r) => s + r.cost_per_lead, 0) / withLeads.length
    : null;

  const ranked = rows
    .map((r) => ({ ...r, health: classify(r, accountAvgCpl) }))
    .sort((a, b) => {
      const order = { poor: 0, attention: 1, excellent: 2 };
      if (order[a.health] !== order[b.health]) return order[a.health] - order[b.health];
      return b.cost - a.cost;
    });

  return (
    <div className="health-grid fade-in">
      {ranked.map((r) => (
        <div
          key={r.campaign_id}
          className={`health-card ${r.health}`}
          onClick={() => onSelectCampaign?.(r.campaign_id, r.campaign_name)}
          style={{ cursor: onSelectCampaign ? "pointer" : "default" }}
        >
          <div className="top-row">
            <div className="name">{r.campaign_name}</div>
            <span className={`status-pill ${r.health}`}>{STATUS_LABEL[r.health]}</span>
          </div>
          <div className="metrics">
            <div className="metric"><div className="k">Spend</div><div className="v">{fmtMoney(r.cost)}</div></div>
            <div className="metric"><div className="k">Leads</div><div className="v">{r.lead_count}</div></div>
            <div className="metric"><div className="k">CTR</div><div className="v">{fmtPct(r.ctr)}</div></div>
            <div className="metric"><div className="k">Conv. rate</div><div className="v">{fmtPct(r.conversion_rate)}</div></div>
            <div className="metric"><div className="k">Cost / lead</div><div className="v">{r.cost_per_lead !== null ? fmtMoney(r.cost_per_lead) : "—"}</div></div>
            <div className="metric"><div className="k">Impr. share</div><div className="v">{r.avg_impression_share !== null ? `${r.avg_impression_share.toFixed(0)}%` : "—"}</div></div>
          </div>
          {!loading && trends[r.campaign_id]?.length > 1 && (
            <div className="spark">
              <Sparkline values={trends[r.campaign_id]} color={STATUS_COLOR[r.health]} width={100} height={26} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
