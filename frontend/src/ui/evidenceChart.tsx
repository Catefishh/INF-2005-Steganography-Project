import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface EvidencePoint { label: string; value: number | null }

interface EvidenceChartProps {
  label: string;
  unit: string;
  points: EvidencePoint[];
  max?: number;
  height?: number;
}

function EvidenceChart({ label, unit, points, max, height = 208, kind }: EvidenceChartProps & { kind: "area" | "bar" }) {
  const available = points.filter((point) => point.value !== null && Number.isFinite(point.value));
  if (!available.length) return <p className="analysis-empty">No measured values available.</p>;

  const rows = points.map((point) => ({ label: point.label, value: point.value }));
  const axis = { fontSize: 11, fill: "#40546b" };
  const axisProps = { dataKey: "label", tick: axis, tickLine: false, axisLine: false, minTickGap: 18 };
  const valueAxis = { tick: axis, tickLine: false, axisLine: false, width: 38, domain: [0, max ?? "auto"] as const };
  const tooltip = <Tooltip formatter={(value) => value === null || value === undefined ? "Unavailable" : `${value} ${unit}`}
    contentStyle={{ background: "#fff", border: "1px solid #bfc7d2", borderRadius: 12, color: "#131b2e" }} />;

  return <div className="evidence-chart" aria-label={label}>
    <div className="evidence-chart-plot" aria-hidden="true">
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 600, height }}>
        {kind === "area" ? <AreaChart data={rows} margin={{ top: 12, right: 14, bottom: 8, left: 0 }}>
          <defs><linearGradient id="evidence-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
          </linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#dce8f4" />
          <XAxis {...axisProps} /><YAxis {...valueAxis} />{tooltip}
          <Area type="linear" dataKey="value" stroke="#006194" strokeWidth={2} fill="url(#evidence-area)"
            connectNulls={false} isAnimationActive={false} />
        </AreaChart> : <BarChart data={rows} margin={{ top: 12, right: 14, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#dce8f4" />
          <XAxis {...axisProps} /><YAxis {...valueAxis} />{tooltip}
          <Bar dataKey="value" fill="#0284c7" radius={[5, 5, 0, 0]} isAnimationActive={false} />
        </BarChart>}
      </ResponsiveContainer>
    </div>
    <details className="evidence-data" open={points.length <= 8}>
      <summary>View {points.length} measurements</summary>
      <div className="table-wrap"><table aria-label={`${label} data`}>
        <thead><tr><th scope="col">Section</th><th scope="col">{unit}</th></tr></thead>
        <tbody>{rows.map((point, index) => <tr key={`${point.label}-${index}`}><th scope="row">{point.label}</th>
          <td>{point.value === null || !Number.isFinite(point.value) ? "Unavailable" : point.value}</td></tr>)}</tbody>
      </table></div>
    </details>
  </div>;
}

export function EvidenceAreaChart(props: EvidenceChartProps) { return <EvidenceChart {...props} kind="area" />; }
export function EvidenceBarChart(props: EvidenceChartProps) { return <EvidenceChart {...props} kind="bar" />; }
