import { useEffect, useState, useCallback, useMemo } from "react";
import { getPerformance, getCampaigns } from "./api";
import { ArrowUpIcon, ArrowDownIcon } from "./icons";

function todayMinus(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(n) { return `$${Number(n).toFixed(2)}`; }
function fmtPct(n) { return `${(Number(n) * 100).toFixed(1)}%`; }

const GROUP_OPTIONS = [
  { key: "keyword", label: "By keyword" },
  { key: "campaign", label: "By campaign" },
  { key: "date", label: "By date" },
];

function SortHeader({ id, label, sort, setSort, className }) {
  const active = sort.key === id;
  return (
    <th
      className={`sortable ${className || ""} ${active ? "active" : ""}`}
      onClick={() => setSort((s) => (s.key === id ? { key: id, dir: s.dir === "asc" ? "desc" : "asc" } : { key: id, dir: id === "cost" ? "desc" : "asc" }))}
    >
      {label}
      <span className="arrow">
        {active ? (sort.dir === "asc" ? <ArrowUpIcon width={10} height={10} strokeWidth={3} /> : <ArrowDownIcon width={10} height={10} strokeWidth={3} />) : "↕"}
      </span>
    </th>
  );
}

export default function PerformanceView({ onSelectKeyword }) {
  const [rows, setRows] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState("keyword");
  const [range, setRange] = useState({ from: todayMinus(30), to: todayMinus(0) });
  const [campaignId, setCampaignId] = useState("");
  const [sort, setSort] = useState({ key: "cost", dir: "desc" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [perfRows, campaignRows] = await Promise.all([
        getPerformance({ ...range, group_by: groupBy, campaign_id: campaignId }),
        getCampaigns(),
      ]);
      setRows(perfRows);
      setCampaigns(campaignRows);
    } finally {
      setLoading(false);
    }
  }, [range, groupBy, campaignId]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      cost: acc.cost + r.cost,
      conversions: acc.conversions + r.conversions,
      lead_count: acc.lead_count + r.lead_count,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, lead_count: 0 }
  );

  const labelKey = groupBy === "date" ? "date" : groupBy === "campaign" ? "campaign_name" : "keyword_text";
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key];
      if (sort.key === labelKey && typeof av === "string") { av = av.toLowerCase(); bv = (bv || "").toLowerCase(); }
      av = av ?? -Infinity; bv = bv ?? -Infinity;
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sort, labelKey]);

  return (
    <div>
      <div className="filters">
        <div className="pill-group">
          {GROUP_OPTIONS.map((g) => (
            <button key={g.key} className={`btn ${groupBy === g.key ? "active" : ""}`} onClick={() => setGroupBy(g.key)}>
              {g.label}
            </button>
          ))}
        </div>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <span style={{ color: "var(--text-muted)" }}>to</span>
        <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </div>

      <div className="summary-row">
        <div className="stat-card"><div className="label">Impressions</div><div className="value-row"><div className="value">{totals.impressions.toLocaleString()}</div></div></div>
        <div className="stat-card"><div className="label">Clicks</div><div className="value-row"><div className="value">{totals.clicks.toLocaleString()}</div></div></div>
        <div className="stat-card"><div className="label">Cost</div><div className="value-row"><div className="value">{fmtMoney(totals.cost)}</div></div></div>
        <div className="stat-card"><div className="label">Conversions</div><div className="value-row"><div className="value">{totals.conversions.toFixed(1)}</div></div></div>
        <div className="stat-card"><div className="label">Leads (matched)</div><div className="value-row"><div className="value">{totals.lead_count}</div></div></div>
      </div>

      {loading ? (
        <div className="loading">Loading performance data…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No performance data for this range yet — run the sync script from Part 3.</div>
      ) : (
        <div className="table-wrap fade-in">
          <table>
            <thead>
              <tr>
                <SortHeader id={labelKey} label={groupBy === "date" ? "Date" : groupBy === "campaign" ? "Campaign" : "Keyword"} sort={sort} setSort={setSort} />
                {groupBy === "keyword" && <th>Campaign</th>}
                <SortHeader id="impressions" label="Impr." sort={sort} setSort={setSort} className="num" />
                <SortHeader id="clicks" label="Clicks" sort={sort} setSort={setSort} className="num" />
                <SortHeader id="ctr" label="CTR" sort={sort} setSort={setSort} className="num" />
                <SortHeader id="cost" label="Cost" sort={sort} setSort={setSort} className="num" />
                <SortHeader id="avg_cpc" label="Avg CPC" sort={sort} setSort={setSort} className="num" />
                <SortHeader id="conversions" label="Conversions" sort={sort} setSort={setSort} className="num" />
                <SortHeader id="lead_count" label="Leads" sort={sort} setSort={setSort} className="num" />
                <SortHeader id="cost_per_lead" label="Cost / Lead" sort={sort} setSort={setSort} className="num" />
                <SortHeader id="avg_impression_share" label="Impr. Share" sort={sort} setSort={setSort} className="num" />
                <SortHeader id="avg_quality_score" label="Quality" sort={sort} setSort={setSort} className="num" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr key={i}>
                  <td
                    style={groupBy === "keyword" && onSelectKeyword ? { cursor: "pointer", textDecoration: "underline" } : undefined}
                    onClick={groupBy === "keyword" ? () => onSelectKeyword?.(r.keyword_id, r.keyword_text) : undefined}
                  >
                    {groupBy === "date" ? r.date?.slice(0, 10) : groupBy === "campaign" ? r.campaign_name : r.keyword_text}
                  </td>
                  {groupBy === "keyword" && <td>{r.campaign_name}</td>}
                  <td className="num">{r.impressions.toLocaleString()}</td>
                  <td className="num">{r.clicks.toLocaleString()}</td>
                  <td className="num">{fmtPct(r.ctr)}</td>
                  <td className="num">{fmtMoney(r.cost)}</td>
                  <td className="num">{fmtMoney(r.avg_cpc)}</td>
                  <td className="num">{r.conversions.toFixed(1)}</td>
                  <td className="num">{r.lead_count}</td>
                  <td className="num">{r.cost_per_lead !== null ? fmtMoney(r.cost_per_lead) : "—"}</td>
                  <td className="num">{r.avg_impression_share !== null ? `${r.avg_impression_share.toFixed(1)}%` : "—"}</td>
                  <td className="num">{r.avg_quality_score !== null ? r.avg_quality_score.toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
