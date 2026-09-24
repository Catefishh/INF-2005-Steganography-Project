import type { Analysis } from "../../api";
import { channelLabel, inspectCopy } from "../../analysis";
import { Panel } from "../../components";

/** Eight bit planes for the selected image channel or audio sample channel. */
export function BitPlanesPanel({ analysis, busy, channel, planesRef, onChannel }: {
  analysis: Analysis; busy: boolean; channel: number;
  planesRef: React.RefObject<HTMLDivElement | null>; onChannel: (index: number) => void;
}) {
  const kind = analysis.info.kind;
  const copy = inspectCopy(kind);
  const strideNote = analysis.stride > 1 ? ` (${copy.strideNote(analysis.stride)})` : "";
  return (
        <Panel title="Bit layers"
          aside={
            <div className="segmented">
              {analysis.channel_names.map((name, index) => (
                <button key={name} type="button" className={channel === index ? "on" : ""} disabled={busy}
                  aria-pressed={channel === index}
                  onClick={() => onChannel(index)}>{name}</button>
              ))}
            </div>
          }>
          <p className="field-hint">
            {channelLabel(analysis)}{strideNote}. {copy.planesNote} Bit 0 is the even/odd filter: even values are black and odd values are white.
          </p>
          <div className="planes" ref={planesRef}>
            {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => (
              <figure key={bit} className={bit < 2 ? "low" : ""}>
                {analysis.reference_bit_planes && <><img src={analysis.reference_bit_planes[bit]} alt={`Original bit plane ${bit}`} /><figcaption>Original · bit {bit}</figcaption></>}
                <img src={analysis.bit_planes[bit]} alt={`Inspected file bit plane ${bit}`} />
                <figcaption>{analysis.reference_bit_planes ? "Stego" : "File"} · bit {bit}{bit === 0 ? " · even black, odd white" : ""}</figcaption>
              </figure>
            ))}
          </div>
          {kind === "audio" && (
            <p className="muted small">
              Audio samples are laid out row by row as a square image, one pixel per sample of the chosen channel.
            </p>
          )}
        </Panel>

  );
}
