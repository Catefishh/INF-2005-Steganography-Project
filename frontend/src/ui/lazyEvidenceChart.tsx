import { lazy, Suspense } from "react";
import type { EvidencePoint } from "./evidenceChart";

const AreaChart = lazy(() => import("./evidenceChart").then(({ EvidenceAreaChart }) => ({ default: EvidenceAreaChart })));
const BarChart = lazy(() => import("./evidenceChart").then(({ EvidenceBarChart }) => ({ default: EvidenceBarChart })));

interface Props { label: string; unit: string; points: EvidencePoint[]; max?: number }

export function EvidenceAreaChart(props: Props) {
  return <Suspense fallback={<p className="field-hint" role="status">Loading chart…</p>}><AreaChart {...props} /></Suspense>;
}

export function EvidenceBarChart(props: Props) {
  return <Suspense fallback={<p className="field-hint" role="status">Loading chart…</p>}><BarChart {...props} /></Suspense>;
}
