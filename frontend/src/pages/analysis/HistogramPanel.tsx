import type { Analysis } from "../../api";
import { inspectCopy, valueRange } from "../../analysis";
import { Histogram, Panel } from "../../components";

const IMAGE_COLORS = ["#e5483a", "#1f9d55", "#2f6fdb"];

export function HistogramPanel({ analysis }: { analysis: Analysis }) {
  const kind = analysis.info.kind;
  const range = valueRange(analysis.info);
  const copy = inspectCopy(kind);
  return (
        <Panel title="Value histogram"
          subtitle="Replacing the lowest bit makes neighbouring pairs of bars the same height. Look for the comb pattern flattening out.">
          <Histogram series={analysis.histograms} colors={kind === "image" ? IMAGE_COLORS : ["#0fa3a3"]} />
          {analysis.reference_histograms && <><p className="field-hint">Original reference histogram</p>
            <Histogram series={analysis.reference_histograms} colors={kind === "image" ? IMAGE_COLORS : ["#0fa3a3"]} /></>}
          <div className="axis">
            <span>{range.min}</span><span>{copy.histogramAxis}</span><span>{range.max}</span>
          </div>
        </Panel>

  );
}
