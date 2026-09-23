import { RsPanel } from "./RsPanel";
import { BitPlanesPanel } from "./BitPlanesPanel";
import { HistogramPanel } from "./HistogramPanel";
import { DiffPanel } from "./ComparisonPanel";
import type { Analysis } from "../../api";
import { evidenceReading } from "../../analysis";
import { Outcome, Panel } from "../../components";
import { AnalysisTiming, BpcsSection, ChiSquareSection } from "../analyse/sections";


/**
 * Results in the order of the strength of the evidence: the reading, then the exact difference,
 * then the statistical test, then the bit layers, then the histogram.
 */
export function InspectResult({ analysis, busy, channel, outcomeRef, onChannel }: {
  analysis: Analysis;
  busy: boolean;
  channel: number;
  outcomeRef: React.RefObject<HTMLHeadingElement | null>;
  onChannel: (index: number) => void;
}) {
  const kind = analysis.info.kind;
  const reading = evidenceReading(analysis);
  const compare = analysis.compare;

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

      <div className="columns">
        {kind === "image" && analysis.rs && <RsPanel rs={analysis.rs} />}
        <ChiSquareSection details={analysis.chi_square_details} busy={busy} />

        <BitPlanesPanel analysis={analysis} busy={busy} channel={channel} onChannel={onChannel} />
      </div>

      <BpcsSection result={analysis} busy={busy} />

      <div className="columns">
        <HistogramPanel analysis={analysis} />

        {analysis.lsb_composite && (
          <Panel title="Lowest bit of red, green and blue as one image">
            <figure className="composite">
              <img src={analysis.lsb_composite} alt="The lowest bit of red, green and blue, shown as a colour image" />
            </figure>
            <p className="field-hint">Even-looking regions can have several causes; use the maps as descriptive evidence.</p>
          </Panel>
        )}
      </div>
      <AnalysisTiming result={analysis} />
    </>
  );
}
