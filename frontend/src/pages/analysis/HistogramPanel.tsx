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
          <ChartViewer title="Inspected value histogram">
            <Histogram series={analysis.histograms} colors={colors} />{axis}
          </ChartViewer>
          {analysis.reference_histograms && <ChartViewer title="Original reference histogram">
            <Histogram series={analysis.reference_histograms} colors={colors} />{axis}
          </ChartViewer>}
        </Panel>

  );
}
