// Generates short, scannable "what changed and what to do about it" cards.
// Every insight here is computed from numbers the API already returns --
// nothing is invented or hardcoded per-account. If the data can't support
// a claim, the insight is simply not shown.
function buildInsights({ current, previous, alerts, rejectionInsight, campaignRows }) {
  const insights = [];

  // Spend trajectory vs prior period of the same length.
  if (previous.cost > 0) {
    const spendChange = ((current.cost - previous.cost) / previous.cost) * 100;
    if (Math.abs(spendChange) >= 10) {
      insights.push({
        tone: spendChange > 0 ? "warn" : "good",
        icon: spendChange > 0 ? "↑" : "↓",
        text: <>Spend is <b>{Math.abs(spendChange).toFixed(0)}% {spendChange > 0 ? "higher" : "lower"}</b> than the prior period.</>,
      });
    }
  }

  // Cost-per-lead trajectory.
  if (previous.cost_per_lead && current.cost_per_lead) {
    const cplChange = ((current.cost_per_lead - previous.cost_per_lead) / previous.cost_per_lead) * 100;
    if (Math.abs(cplChange) >= 10) {
      insights.push({
        tone: cplChange > 0 ? "bad" : "good",
        icon: cplChange > 0 ? "↑" : "↓",
        text: <>Cost per lead <b>{cplChange > 0 ? "rose" : "fell"} {Math.abs(cplChange).toFixed(0)}%</b> vs the prior period.</>,
      });
    }
  }

  // Which campaign is driving the most leads right now.
  if (campaignRows && campaignRows.length > 1 && current.total_leads > 0) {
    const top = [...campaignRows].sort((a, b) => b.lead_count - a.lead_count)[0];
    if (top.lead_count > 0) {
      const share = (top.lead_count / current.total_leads) * 100;
      if (share >= 30) {
        insights.push({
          tone: "info",
          icon: "★",
          text: <><b>{top.campaign_name}</b> generated {share.toFixed(0)}% of leads this period.</>,
        });
      }
    }
  }

  // Highest-severity live alerts (wasted spend / expensive CPL / budget-limited).
  const highAlert = alerts.find((a) => a.severity === "high");
  if (highAlert) {
    insights.push({
      tone: "bad",
      icon: "⚠",
      text: <><b>{highAlert.keyword_text}</b> ({highAlert.campaign_name}) — {highAlert.message.toLowerCase()}.</>,
    });
  }
  const mediumAlert = alerts.find((a) => a.severity === "medium");
  if (mediumAlert) {
    insights.push({
      tone: "warn",
      icon: "!",
      text: <><b>{mediumAlert.keyword_text}</b> ({mediumAlert.campaign_name}) — {mediumAlert.message.toLowerCase()}.</>,
    });
  }

  // Lead-quality: the single biggest rejection reason this period.
  if (rejectionInsight.breakdown.length > 0) {
    const top = rejectionInsight.breakdown[0];
    const totalRejected = rejectionInsight.breakdown.reduce((s, r) => s + r.count, 0);
    insights.push({
      tone: "warn",
      icon: "✕",
      text: <><b>{top.reason}</b> is the top rejection reason ({top.count} of {totalRejected} rejected leads).</>,
    });
  }

  // Sold vs rejected ratio, when we have enough resolved leads to say anything.
  const resolved = current.sold_leads + current.rejected_leads;
  if (resolved >= 5) {
    const soldRate = (current.sold_leads / resolved) * 100;
    insights.push({
      tone: soldRate >= 60 ? "good" : soldRate >= 40 ? "info" : "bad",
      icon: "✓",
      text: <><b>{soldRate.toFixed(0)}%</b> of resolved leads were sold this period ({current.sold_leads} of {resolved}).</>,
    });
  }

  return insights;
}

export default function InsightsPanel({ current, previous, alerts, rejectionInsight, campaignRows }) {
  const insights = buildInsights({ current, previous, alerts, rejectionInsight, campaignRows });

  if (insights.length === 0) {
    return <div className="empty-state">Nothing notable to flag for this period — check back as more data comes in.</div>;
  }

  return (
    <div className="insight-grid fade-in">
      {insights.map((ins, i) => (
        <div className={`insight-card ${ins.tone}`} key={i}>
          <div className="icon">{ins.icon}</div>
          <div className="body">{ins.text}</div>
        </div>
      ))}
    </div>
  );
}
