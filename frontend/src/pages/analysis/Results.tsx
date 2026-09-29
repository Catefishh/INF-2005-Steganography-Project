import { useState } from "react";
import { RsPanel } from "./RsPanel";
import { BitPlanesPanel } from "./BitPlanesPanel";
import { HistogramPanel } from "./HistogramPanel";
import { DiffPanel } from "./ComparisonPanel";
import type { Analysis } from "../../api";
import { evidenceReading } from "../../analysis";
import { Outcome, Panel } from "../../components";
import { AnalysisTiming, BpcsSection, ChiSquareSection } from "../analyse/sections";
import { BitPlaneViewer } from "../../ui/BitPlaneViewer";


/**
 * Results in the order of the strength of the evidence: the reading, then the exact difference,
 * then the statistical test, then the bit layers, then the histogram.
 */
export function InspectResult({ analysis, busy, channel, outcomeRef, planesRef, onChannel }: {
  analysis: Analysis;
  busy: boolean;
  channel: number;
  outcomeRef: React.RefObject<HTMLHeadingElement | null>;
  planesRef: React.RefObject<HTMLDivElement | null>;
  onChannel: (index: number) => void;
}) {
  const kind = analysis.info.kind;
  const reading = evidenceReading(analysis);
  const compare = analysis.compare;
  const [compositeViewer, setCompositeViewer] = useState<{analysis: Analysis; origin: HTMLElement} | null>(null);

  return (
    <>
      <div>
        <Outcome tone={reading.tone === "flat" ? "flat" : reading.tone} icon={reading.tone === "good" ? "shield" : "alert"}
          label="Reading of the evidence" title={reading.headline} summary={reading.summary} headingRef={outcomeRef} />
        <p className="field-hint reading-note">
          This reading describes the measured figures; it cannot establish embedding or authenticity.
        </p>
      </div>

      {compare && <DiffPanel analysis={analysis} />}

      <div className={kind === "image" && analysis.rs ? "columns" : ""}>
        {kind === "image" && analysis.rs && <div><RsPanel rs={analysis.rs} /></div>}
        <div><ChiSquareSection details={analysis.chi_square_details} busy={busy} /></div>
      </div>

      <BitPlanesPanel analysis={analysis} busy={busy} channel={channel} planesRef={planesRef} onChannel={onChannel} />

      <BpcsSection result={analysis} busy={busy} />

      <div className="columns">
        <HistogramPanel analysis={analysis} />

        {analysis.lsb_composite && (
          <Panel title="Lowest bit of red, green and blue as one image">
            <div className="chart-toolbar">
              <button type="button" className="btn ghost sm chart-popout"
                onClick={(event) => setCompositeViewer({analysis, origin: event.currentTarget})}>Pop out image</button>
            </div>
            <figure className="composite">
              <img src={analysis.lsb_composite} alt="The lowest bit of red, green and blue, shown as a colour image" />
            </figure>
            <p className="field-hint">Even-looking regions can have several causes; use the maps as descriptive evidence.</p>
            {compositeViewer?.analysis === analysis && <BitPlaneViewer src={analysis.lsb_composite}
              label="Lowest bit of red, green and blue as one image" sampling="" origin={compositeViewer.origin}
              onClose={() => setCompositeViewer(null)} />}
          </Panel>
        )}
      </div>
      <AnalysisTiming result={analysis} />
    </>
  );
}
