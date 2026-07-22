import { useEffect, useState, useCallback } from "react";
import { getOverview, getPerformance } from "./api";
import TrendChart from "./TrendChart";
import StatCard from "./StatCard";
import CampaignHealth from "./CampaignHealth";
import InsightsPanel from "./InsightsPanel";
import RecentActivity from "./RecentActivity";

function fmtMoney(n) { return n === null || n === undefined ? "—" : `$${Number(n).toFixed(2)}`; }

const SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

const METRIC_OPTIONS = [
  { key: "cost", label: "Spend", color: "var(--accent)" },
  { key: "leads", label: "Leads", color: "var(--warning)" },
  { key: "clicks", label: "Clicks", color: "var(--success)" },
];

export default function OverviewView({ onSelectKeyword }) {
  const [data, setData] = useState(null);
  const [campaignRows, setCampaignRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [chartMetrics, setChartMetrics] = useState(["cost", "leads"]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await getOverview(days);
      setData(overview);
      const perf = await getPerformance({ from: overview.period.from, to: overview.period.to, group_by: "campaign" });
      setCampaignRows(perf);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) return <div className="loading">Loading overview…</div>;

  const { current, previous, trend, alerts, rejection_insight, period } = data;

  function toggleMetric(key) {
    setChartMetrics((prev) => {
      if (prev.includes(key)) return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
      return [...prev, key];
    });
  }

  return (
    <div>
      <div className="filters">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
        <span className="spacer" />
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{period.from} → {period.to}</span>
      </div>

      <div className="summary-row fade-in">
        <StatCard
          label="Spend"
          value={fmtMoney(current.cost)}
          current={current.cost}
          previous={previous.cost}
          invert
          sparkValues={trend.map((t) => t.cost)}
          sparkColor="var(--accent)"
        />
        <StatCard
          label="Leads"
          value={current.total_leads}
          current={current.total_leads}
          previous={previous.total_leads}
          sparkValues={trend.map((t) => t.leads)}
          sparkColor="var(--warning)"
        />
        <StatCard
          label="Cost / Lead"
          value={fmtMoney(current.cost_per_lead)}
          current={current.cost_per_lead}
          previous={previous.cost_per_lead}
          invert
        />
        <StatCard label="Sold" value={current.sold_leads} />
        <StatCard label="Rejected" value={current.rejected_leads} />
      </div>

      <div className="section-heading">
        <h3>Campaign health</h3>
        <span className="sub">ranked by cost per lead vs. account average</span>
      </div>
      <CampaignHealth
        rows={campaignRows}
        from={period.from}
        to={period.to}
        onSelectCampaign={() => {}}
      />

      <div className="section-heading">
        <h3>Insights</h3>
        <span className="sub">generated from this period's data</span>
      </div>
      <InsightsPanel
        current={current}
        previous={previous}
        alerts={alerts}
        rejectionInsight={rejection_insight}
        campaignRows={campaignRows}
      />

      {trend.length > 0 && (
        <>
          <div className="section-heading">
            <h3>Performance trend</h3>
            <div className="pill-group">
              {METRIC_OPTIONS.map((m) => (
                <button
                  key={m.key}
                  className={`btn ${chartMetrics.includes(m.key) ? "active" : ""}`}
                  onClick={() => toggleMetric(m.key)}
                  style={chartMetrics.includes(m.key) ? { color: m.color } : undefined}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap" style={{ padding: 16, marginBottom: 24 }}>
            <TrendChart
              data={trend}
              series={METRIC_OPTIONS.filter((m) => chartMetrics.includes(m.key))}
            />
          </div>
        </>
      )}

      {alerts.length > 0 && (
        <>
          <div className="section-heading"><h3>Needs attention</h3></div>
          <div className="table-wrap" style={{ marginBottom: 24 }}>
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Keyword</th>
                  <th>Campaign</th>
                  <th>Issue</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={i}>
                    <td><span className={`badge ${a.severity === "high" ? "lost" : "new"}`}>{SEVERITY_LABEL[a.severity]}</span></td>
                    <td
                      style={{ cursor: onSelectKeyword ? "pointer" : "default", textDecoration: onSelectKeyword ? "underline" : "none" }}
                      onClick={() => onSelectKeyword?.(a.keyword_id, a.keyword_text)}
                    >
                      {a.keyword_text}
                    </td>
                    <td>{a.campaign_name}</td>
                    <td>{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-heading"><h3>Recent activity</h3></div>
      <RecentActivity onSelectKeyword={onSelectKeyword} />

      {rejection_insight.breakdown.length > 0 && (
        <>
          <div className="section-heading"><h3>Lead quality: why leads get rejected</h3></div>
          <div className="summary-row">
            {rejection_insight.breakdown.map((r) => (
              <div className="stat-card" key={r.reason}>
                <div className="label">{r.reason}</div>
                <div className="value-row"><div className="value">{r.count}</div></div>
              </div>
            ))}
          </div>

          {rejection_insight.by_keyword.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 24 }}>
              <table>
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Campaign</th>
                    <th className="num">Sold</th>
                    <th className="num">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {rejection_insight.by_keyword.map((r, i) => (
                    <tr key={i}>
                      <td>{r.keyword_text}</td>
                      <td>{r.campaign_name}</td>
                      <td className="num">{r.sold_count}</td>
                      <td className="num">{r.rejected_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {alerts.length === 0 && rejection_insight.breakdown.length === 0 && campaignRows?.length === 0 && (
        <div className="empty-state">No alerts and no rejection data yet for this period.</div>
      )}
    </div>
  );
}
