import type { Analysis } from "../../api";
import { inspectCopy, valueRange } from "../../analysis";
import { ChartViewer, Histogram, Panel } from "../../components";

const IMAGE_COLORS = ["#e5483a", "#1f9d55", "#2f6fdb"];

export function HistogramPanel({ analysis }: { analysis: Analysis }) {
  const kind = analysis.info.kind;
  const range = valueRange(analysis.info);
  const copy = inspectCopy(kind);
  const colors = kind === "image" ? IMAGE_COLORS : ["#0fa3a3"];
  const axis = <div className="axis"><span>{range.min}</span><span>{copy.histogramAxis}</span><span>{range.max}</span></div>;
  return (
        <Panel title="Value histogram"
          subtitle="Replacing the lowest bit makes neighbouring pairs of bars the same height. Look for the comb pattern flattening out.">
          <ChartViewer title="Inspected value histogram" snapshot={{ kind: "histogram", title: "Inspected value histogram",
            series: analysis.histograms, colors, min: String(range.min), max: String(range.max), axis: copy.histogramAxis,
            notes: ["Replacing the lowest bit can flatten neighbouring pairs of bars. The pattern is descriptive evidence, not proof of embedding."] }}>
            <Histogram series={analysis.histograms} colors={colors} />{axis}
          </ChartViewer>
          {analysis.reference_histograms && <ChartViewer title="Original reference histogram" snapshot={{ kind: "histogram", title: "Original reference histogram",
            series: analysis.reference_histograms, colors, min: String(range.min), max: String(range.max), axis: copy.histogramAxis,
            notes: ["Compare with the inspected file to assess measured changes. A histogram alone cannot establish authenticity."] }}>
            <Histogram series={analysis.reference_histograms} colors={colors} />{axis}
          </ChartViewer>}
        </Panel>

  );
}
