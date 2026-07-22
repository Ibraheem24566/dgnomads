import { useEffect, useState, useCallback } from "react";
import { getLeads } from "./api";

function initials(name, email) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const STATUS_LABEL = { new: "new", contacted: "contacted", qualified: "qualified", won: "won", lost: "lost" };

// A live-feed treatment of the most recent leads, in place of a plain table.
// Reuses the same /api/leads endpoint LeadsView uses -- just the newest few.
export default function RecentActivity({ limit = 6, onSelectKeyword }) {
  const [leads, setLeads] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getLeads({});
      setLeads(rows.slice(0, limit));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  if (loading || !leads) return <div className="loading">Loading recent activity…</div>;
  if (leads.length === 0) return <div className="empty-state">No leads yet.</div>;

  return (
    <div className="feed fade-in">
      {leads.map((lead) => (
        <div className="feed-card" key={lead.id}>
          <div className="avatar">{initials(lead.name, lead.email)}</div>
          <div className="main">
            <div className="name-line">
              {lead.name || lead.email || "Unnamed lead"}
              <span className={`badge ${lead.status}`}>{STATUS_LABEL[lead.status] || lead.status}</span>
            </div>
            <div className="sub-line">
              {lead.campaign_name || "Unattributed"}
              {(lead.keyword_text || lead.raw_keyword_text) && (
                <>
                  {" · "}
                  <span
                    style={{ cursor: onSelectKeyword ? "pointer" : "default", textDecoration: onSelectKeyword ? "underline" : "none" }}
                    onClick={() => lead.keyword_id && onSelectKeyword?.(lead.keyword_id, lead.keyword_text)}
                  >
                    {lead.keyword_text || lead.raw_keyword_text}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="meta">
            <div className="time">{timeAgo(lead.created_at)}</div>
            {lead.value !== null && lead.value !== undefined && (
              <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>${Number(lead.value).toFixed(0)}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
