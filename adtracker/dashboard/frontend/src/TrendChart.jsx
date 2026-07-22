import { useRef, useState } from "react";

// Builds a smoothed path (simple Catmull-Rom -> cubic Bezier conversion)
// instead of straight polyline segments, purely a visual upgrade -- the
// underlying points are unchanged.
function smoothPath(points) {
  if (points.length < 3) return `M${points.map((p) => p.join(",")).join(" L")}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// Minimal dependency-free line chart. Each series is normalized to its own
// 0-1 range so cost (dollars) and leads (small counts) can share one chart
// without one line flattening the other.
export default function TrendChart({ data, series }) {
  const svgRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!data || data.length === 0) return null;

  const width = 700;
  const height = 240;
  const padding = 32;
  const innerW = width - padding * 2;

  const ranges = series.map((s) => {
    const values = data.map((d) => d[s.key]);
    return { max: Math.max(...values, 1), min: Math.min(0, ...values) };
  });

  const xAt = (i) => padding + (i / Math.max(data.length - 1, 1)) * innerW;
  const yAt = (v, key) => {
    const idx = series.findIndex((s) => s.key === key);
    const { max, min } = ranges[idx];
    const range = max - min || 1;
    return height - padding - ((v - min) / range) * (height - padding * 2);
  };

  const seriesPoints = series.map((s) => data.map((d, i) => [xAt(i), yAt(d[s.key], s.key)]));

  function handleMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const ratio = (x - padding) / innerW;
    const idx = Math.round(ratio * (data.length - 1));
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
  }

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;
  const tooltipX = hoverIdx !== null ? (xAt(hoverIdx) / width) * 100 : 0;
  const tooltipY = hoverIdx !== null ? (Math.min(...seriesPoints.map((p) => p[hoverIdx][1])) / height) * 100 : 0;

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          {series.map((s) => (
            <linearGradient id={`trend-grad-${s.key}`} key={s.key} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* faint horizontal gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={padding} y1={padding + f * (height - padding * 2)} x2={width - padding} y2={padding + f * (height - padding * 2)} stroke="var(--border)" strokeDasharray="2,4" />
        ))}
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border)" />

        {series.map((s, si) => {
          const pts = seriesPoints[si];
          const path = smoothPath(pts);
          const areaPath = `${path} L${pts[pts.length - 1][0].toFixed(1)},${height - padding} L${pts[0][0].toFixed(1)},${height - padding} Z`;
          return (
            <g key={s.key}>
              {si === 0 && <path d={areaPath} fill={`url(#trend-grad-${s.key})`} stroke="none" />}
              <path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
            </g>
          );
        })}

        {/* hover indicator */}
        {hoverIdx !== null && (
          <>
            <line x1={xAt(hoverIdx)} y1={padding} x2={xAt(hoverIdx)} y2={height - padding} stroke="var(--border-strong)" strokeDasharray="3,3" />
            {series.map((s, si) => (
              <circle key={s.key} cx={seriesPoints[si][hoverIdx][0]} cy={seriesPoints[si][hoverIdx][1]} r="3.5" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
            ))}
          </>
        )}

        {/* x-axis labels: first, middle, last date */}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={xAt(i)} y={height - 8} fontSize="10" fill="var(--text-muted)" textAnchor="middle">
            {data[i]?.date?.slice(5)}
          </text>
        ))}

        {/* legend */}
        {series.map((s, i) => (
          <g key={s.key} transform={`translate(${padding + i * 100}, 12)`}>
            <rect width="10" height="10" fill={s.color} rx="2" />
            <text x="14" y="9" fontSize="11" fill="var(--text-muted)">{s.label}</text>
          </g>
        ))}
      </svg>

      {hovered && (
        <div className="chart-tooltip" style={{ left: `${tooltipX}%`, top: `${tooltipY}%` }}>
          <div className="t-date">{hovered.date}</div>
          {series.map((s) => (
            <div className="t-row" key={s.key}>
              <span className="t-dot" style={{ background: s.color }} />
              {s.label}: {typeof hovered[s.key] === "number" ? hovered[s.key].toLocaleString(undefined, { maximumFractionDigits: 2 }) : hovered[s.key]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
