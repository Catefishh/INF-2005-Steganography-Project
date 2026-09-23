import type { ChiSquareSegment } from "../api";
export function Histogram({ series, colors }: { series: number[][]; colors: string[] }) {
  let max = 1;
  for (const channel of series) for (const value of channel) if (value > max) max = value;
  return (
    <svg className="histogram" viewBox="0 0 256 100" preserveAspectRatio="none" role="img" aria-label="Value histogram">
      {series.map((channel, index) => (
        <path key={index} stroke={colors[index % colors.length]} strokeWidth={1} opacity={0.7}
          d={channel.map((value, x) => `M${x + 0.5} 100V${100 - (value / max) * 100}`).join("")} />
      ))}
    </svg>
  );
}

export function ChiStrip({ values, segments, threshold = 0.95 }: { values: (number | null)[]; segments?: ChiSquareSegment[]; threshold?: number }) {
  return (
    <div className="chi" role="img" aria-label="Chi-square p-value per segment">
      {values.map((p, index) => (
        <div key={index} className="chi-bar" title={segments?.[index]
          ? `Segment ${index + 1}: ${segments[index].sample_count} samples, ${segments[index].valid_category_count} valid pairs; ${p === null ? segments[index].reason : `p = ${p.toFixed(4)}`}`
          : p === null ? `Segment ${index + 1}: not enough data` : `Segment ${index + 1}: p = ${p.toFixed(4)}`}>
          <span style={{
            height: `${Math.max(2, (p ?? 0) * 100)}%`,
            background: p === null ? "var(--line)" : p >= threshold ? "var(--coral)" : p >= 0.5 ? "var(--amber)" : "var(--teal)",
          }} />
        </div>
      ))}
    </div>
  );
}
