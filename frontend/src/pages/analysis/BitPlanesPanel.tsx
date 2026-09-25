import { useEffect, useState } from "react";
import type { Analysis } from "../../api";
import { channelLabel, inspectCopy } from "../../analysis";
import { Panel } from "../../components";
import { BitPlaneViewer } from "../../ui/BitPlaneViewer";

/** Eight bit planes for the selected image channel or audio sample channel. */
export function BitPlanesPanel({ analysis, busy, channel, planesRef, onChannel }: {
  analysis: Analysis; busy: boolean; channel: number;
  planesRef: React.RefObject<HTMLDivElement | null>; onChannel: (index: number) => void;
}) {
  const kind = analysis.info.kind;
  const copy = inspectCopy(kind);
  const strideNote = analysis.stride > 1 ? ` (${copy.strideNote(analysis.stride)})` : "";
  const [viewer, setViewer] = useState<{src: string; label: string; origin: HTMLElement} | null>(null);
  useEffect(() => setViewer(null), [analysis, channel]);
  const sampling = analysis.stride > 1 ? `Sampled analysis image: ${copy.strideNote(analysis.stride)}. This is not a full-resolution carrier map.` : "";
  function thumbnail(src: string, label: string) {
    return <button type="button" className="plane-button" aria-label={`Enlarge ${label}`}
      onClick={(event) => setViewer({src, label, origin: event.currentTarget})}><img src={src} alt="" /></button>;
  }
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
                {analysis.reference_bit_planes && <>{thumbnail(analysis.reference_bit_planes[bit], `Original ${analysis.channel_names[channel]} bit ${bit}`)}<figcaption>Original · bit {bit}</figcaption></>}
                {thumbnail(analysis.bit_planes[bit], `${analysis.reference_bit_planes ? "Stego" : "File"} ${analysis.channel_names[channel]} bit ${bit}`)}
                <figcaption>{analysis.reference_bit_planes ? "Stego" : "File"} · bit {bit}{bit === 0 ? " · even black, odd white" : ""}</figcaption>
              </figure>
            ))}
          </div>
          {kind === "audio" && (
            <p className="muted small">
              Audio samples are laid out row by row as a square image, one pixel per sample of the chosen channel.
            </p>
          )}
          {viewer && <BitPlaneViewer src={viewer.src} label={viewer.label} sampling={sampling} origin={viewer.origin} onClose={() => setViewer(null)} />}
        </Panel>

  );
}
