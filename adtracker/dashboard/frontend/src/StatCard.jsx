import Sparkline from "./Sparkline";
import { ArrowUpIcon, ArrowDownIcon } from "./icons";

function pctChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export function ChangeBadge({ current, previous, invert = false }) {
  const change = pctChange(current, previous);
  if (change === null || !isFinite(change)) return null;
  const isGood = invert ? change < 0 : change > 0;
  const cls = change === 0 ? "flat" : isGood ? "good" : "bad";
  const Arrow = change < 0 ? ArrowDownIcon : ArrowUpIcon;
  return (
    <span className={`change-badge ${cls}`}>
      {change !== 0 && <Arrow width={10} height={10} strokeWidth={3} />}
      {Math.abs(change).toFixed(0)}%
    </span>
  );
}

// A single top-line metric card: label, big value, change-vs-prior badge,
// and an optional sparkline built from the trend series for that metric.
export default function StatCard({ label, value, current, previous, invert, sparkValues, sparkColor }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value-row">
        <div className="value">{value}</div>
        <ChangeBadge current={current} previous={previous} invert={invert} />
      </div>
      {sparkValues && sparkValues.length > 1 && (
        <div className="spark">
          <Sparkline values={sparkValues} color={sparkColor} />
        </div>
      )}
    </div>
  );
}
