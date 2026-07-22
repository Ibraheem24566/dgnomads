import { useEffect, useState, useCallback, useMemo } from "react";
import { getLeads, updateLead, getCampaigns } from "./api";
import { ArrowUpIcon, ArrowDownIcon } from "./icons";

const STATUS_OPTIONS = ["new", "contacted", "qualified", "won", "lost"];

function formatMatchLabel(status) {
  return { matched: "Matched", no_match: "No match", no_tracking_data: "No tracking data", manual: "Manual" }[status] || status;
}

function initials(name, email) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

const SORTERS = {
  name: (l) => (l.name || l.email || "").toLowerCase(),
  keyword: (l) => (l.keyword_text || l.raw_keyword_text || "").toLowerCase(),
  campaign: (l) => (l.campaign_name || "").toLowerCase(),
  status: (l) => l.status,
  value: (l) => Number(l.value) || -Infinity,
  created_at: (l) => new Date(l.created_at).getTime(),
};

function SortHeader({ id, label, sort, setSort, className }) {
  const active = sort.key === id;
  return (
    <th
      className={`sortable ${className || ""} ${active ? "active" : ""}`}
      onClick={() => setSort((s) => (s.key === id ? { key: id, dir: s.dir === "asc" ? "desc" : "asc" } : { key: id, dir: "asc" }))}
    >
      {label}
      <span className="arrow">
        {active ? (sort.dir === "asc" ? <ArrowUpIcon width={10} height={10} strokeWidth={3} /> : <ArrowDownIcon width={10} height={10} strokeWidth={3} />) : "↕"}
      </span>
    </th>
  );
}

export default function LeadsView({ keywordFilter, onClearKeywordFilter }) {
  const [leads, setLeads] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: "", campaign_id: "", search: "" });
  const [sort, setSort] = useState({ key: "created_at", dir: "desc" });

  // combine manual filters with a keyword drill-down passed in from another tab
  const effectiveFilters = useMemo(
    () => (keywordFilter?.id ? { ...filters, keyword_id: keywordFilter.id } : filters),
    [filters, keywordFilter?.id]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leadRows, campaignRows] = await Promise.all([getLeads(effectiveFilters), getCampaigns()]);
      setLeads(leadRows);
      setCampaigns(campaignRows);
    } finally {
      setLoading(false);
    }
  }, [effectiveFilters]);

  useEffect(() => { load(); }, [load]);

  const sortedLeads = useMemo(() => {
    const getter = SORTERS[sort.key] || SORTERS.created_at;
    const copy = [...leads];
    copy.sort((a, b) => {
      const av = getter(a), bv = getter(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [leads, sort]);

  function setLocalField(id, field, value) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }

  async function commitField(id, field, value) {
    await updateLead(id, { [field]: value });
  }

  return (
    <div>
      <div className="filters">
        <input
          placeholder="Search name or email"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.campaign_id} onChange={(e) => setFilters((f) => ({ ...f, campaign_id: e.target.value }))}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="spacer" />
        {keywordFilter?.id && (
          <span className="badge matched" style={{ cursor: "pointer" }} onClick={onClearKeywordFilter} title="Click to clear">
            Keyword: {keywordFilter.text} ✕
          </span>
        )}
        {!loading && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{sortedLeads.length} lead{sortedLeads.length === 1 ? "" : "s"}</span>}
      </div>

      {loading ? (
        <div className="loading">Loading leads…</div>
      ) : leads.length === 0 ? (
        <div className="empty-state">No leads match these filters yet.</div>
      ) : (
        <div className="table-wrap fade-in">
          <table>
            <thead>
              <tr>
                <SortHeader id="name" label="Lead" sort={sort} setSort={setSort} />
                <SortHeader id="keyword" label="Keyword" sort={sort} setSort={setSort} />
                <SortHeader id="campaign" label="Campaign" sort={sort} setSort={setSort} />
                <th>Attribution</th>
                <SortHeader id="status" label="Status" sort={sort} setSort={setSort} />
                <SortHeader id="value" label="Value" sort={sort} setSort={setSort} className="num" />
                <th>Notes</th>
                <SortHeader id="created_at" label="Received" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {sortedLeads.map((lead) => (
                <tr key={lead.id} className={lead.match_status}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="avatar">{initials(lead.name, lead.email)}</div>
                      <div>
                        <div>{lead.name || "—"}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{lead.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{lead.keyword_text || lead.raw_keyword_text || "—"}</td>
                  <td>{lead.campaign_name || "—"}</td>
                  <td><span className={`badge ${lead.match_status}`}>{formatMatchLabel(lead.match_status)}</span></td>
                  <td>
                    <select
                      className="inline-edit"
                      value={lead.status}
                      onChange={(e) => {
                        setLocalField(lead.id, "status", e.target.value);
                        commitField(lead.id, "status", e.target.value);
                      }}
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <input
                      className="inline-edit value"
                      type="number"
                      value={lead.value ?? ""}
                      placeholder="—"
                      onChange={(e) => setLocalField(lead.id, "value", e.target.value)}
                      onBlur={(e) => commitField(lead.id, "value", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="inline-edit"
                      value={lead.notes ?? ""}
                      placeholder="Add a note…"
                      onChange={(e) => setLocalField(lead.id, "notes", e.target.value)}
                      onBlur={(e) => commitField(lead.id, "notes", e.target.value)}
                    />
                  </td>
                  <td>{new Date(lead.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
