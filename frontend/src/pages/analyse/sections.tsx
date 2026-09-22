import type { Analysis, BpcsMetrics, BpcsResult, ChiSquareDetails } from "../../api";
import { ChiStrip, Histogram, Icon, Panel, Stat } from "../../components";

export function BitPlanesSection({ result, busy, onChannel }: { result: Analysis; busy: boolean; onChannel: (channel: number) => void }) {
  return <Panel step="2" title="Bit planes" aria-busy={busy} subtitle={`${result.channel_names[result.channel]} channel${result.stride > 1 ? ` (every ${result.stride}${result.info.kind === "audio" ? "th sample" : "th pixel"} shown)` : ""}. High planes carry the picture; low planes look like noise.`} aside={<div className="segmented">{result.channel_names.map((name, index) => <button key={name} type="button" className={result.channel === index ? "on" : ""} disabled={busy} onClick={() => onChannel(index)}>{name}</button>)}</div>}>
    <div className="planes">{[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => <figure key={bit} className={bit < 2 ? "low" : ""}><img src={result.bit_planes[bit]} alt={`Bit plane ${bit}`} /><figcaption>Bit {bit}{bit === 7 ? " (MSB)" : bit === 0 ? " (LSB)" : ""}</figcaption></figure>)}</div>
    {result.info.kind === "audio" && <p className="muted small">Audio samples are laid out row by row as a square image.</p>}
  </Panel>;
}

function Metrics({ metrics }: { metrics: BpcsMetrics }) {
  return <div className="stats"><Stat label="Blocks" value={metrics.block_count.toLocaleString()} /><Stat label="Complex" value={`${metrics.complex_blocks.toLocaleString()} (${metrics.complex_percent.toFixed(1)}%)`} /><Stat label="Transitions" value={`${metrics.transition_count.toLocaleString()} / ${metrics.possible_transition_count.toLocaleString()}`} /><Stat label="Theoretical capacity" value={`${metrics.capacity_bits.toLocaleString()} bits (${metrics.capacity_bytes_floor} whole bytes + ${metrics.capacity_remainder_bits} bits)`} /></div>;
}

export function BpcsSection({ result, busy }: { result: Analysis; busy: boolean }) {
  const bpcs: BpcsResult = result.bpcs;
  return <Panel step="3" title="BPCS complexity segmentation" aria-busy={busy} subtitle="Image-only descriptive analysis of bit-plane complexity. It does not produce an authenticity verdict.">
    {!bpcs.supported ? <div className="note note-warn"><Icon name="alert" /><span>{bpcs.reason} BPCS settings apply to images only.</span></div> : <>
      <div className="facts"><span>Channel <b>{result.channel_names[bpcs.config.channel]}</b></span><span>Blocks <b>{bpcs.config.block_size} x {bpcs.config.block_size}</b></span><span>Planes <b>{bpcs.config.bit_plane_start} to {bpcs.config.bit_plane_end}</b></span><span>Threshold <b>{bpcs.config.complexity_threshold}</b></span></div>
      <Metrics metrics={bpcs.summary} />
      <div className="bpcs-planes">{bpcs.planes.map((plane) => <figure key={plane.bit_plane}><div className="bpcs-maps"><img src={plane.complexity_map} alt={`Bit ${plane.bit_plane} complexity map`} /><img src={plane.classification_map} alt={`Bit ${plane.bit_plane} complex-block classification map`} /></div><figcaption>Bit {plane.bit_plane}: complexity and classification maps</figcaption></figure>)}</div>
      {bpcs.comparison && <div className="note note-good"><Icon name="layers" /><span>Descriptive comparison only; no detector verdict. {bpcs.comparison.summary.changed_blocks} blocks changed and {bpcs.comparison.summary.classification_flips} classifications flipped.</span></div>}
    </>}
  </Panel>;
}

export function ChiSquareSection({ details, busy }: { details: ChiSquareDetails; busy: boolean }) {
  const interpretable = details.segments.filter((segment) => segment.interpretable).length;
  return <Panel step="4" title="Chi-square attack (pairs of values)" aria-busy={busy} subtitle="Westfeld-Pfitzmann pairs-of-values analysis. A high p-value is descriptive evidence, not proof of embedding.">
    <ChiStrip values={details.segments} /><div className="legend"><span><i style={{ background: "var(--teal)" }} /> p &lt; 0.5 descriptive range</span><span><i style={{ background: "var(--amber)" }} /> 0.5 to 0.95 descriptive range</span><span><i style={{ background: "var(--coral)" }} /> p ≥ 0.95 presentation heuristic</span></div>
    <div className="stats"><Stat label="Whole channel p" value={details.overall.p_value === null ? "-" : details.overall.p_value.toFixed(4)} /><Stat label="Interpretable segments" value={`${interpretable} / ${details.segments.length}`} /><Stat label="Valid pairs" value={details.overall.valid_category_count.toLocaleString()} /><Stat label="Samples" value={details.overall.sample_count.toLocaleString()} /></div>
    <p className="muted small">{details.explanation.high_p_value}</p><ul className="analysis-limitations">{details.explanation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
  </Panel>;
}

export function HistogramSection({ result, busy }: { result: Analysis; busy: boolean }) {
  return <Panel step="5" title="Histogram" aria-busy={busy} subtitle="Neighbouring value pairs can become similar under LSB replacement."><Histogram series={result.histograms} colors={result.info.kind === "image" ? ["#e5483a", "#1f9d55", "#2f6fdb"] : ["#0fa3a3"]} /><div className="axis"><span>0</span><span>value</span><span>255</span></div>{result.lsb_composite && <figure className="composite"><img src={result.lsb_composite} alt="LSB of R, G and B" /><figcaption>LSB of R, G and B shown as a colour image</figcaption></figure>}</Panel>;
}

export function DifferenceSection({ result, busy }: { result: Analysis; busy: boolean }) {
  return <Panel step="6" title="Difference with the original cover" aria-busy={busy} subtitle="Changed values are descriptive evidence for this supplied pair, not a verification verdict.">{!result.compare ? <div className="analysis-empty">Add a matching original cover to calculate changed values and difference maps.</div> : <><div className="stats"><Stat label="Values changed" value={result.compare.slots_changed.toLocaleString()} /><Stat label="Bits changed" value={result.compare.bits_changed.toLocaleString()} /><Stat label="Largest change" value={`±${result.compare.max_difference}`} /><Stat label="PSNR" value={result.compare.psnr_db === null ? "∞ (identical)" : `${result.compare.psnr_db.toFixed(2)} dB`} /></div><div className="planes two"><figure><img src={result.compare.changed_map} alt="Changed locations" /><figcaption>White = changed value</figcaption></figure>{result.compare.amplified && <figure><img src={result.compare.amplified} alt="Amplified difference" /><figcaption>|stego − cover| × 64</figcaption></figure>}</div></>}</Panel>;
}

export function AnalysisTiming({ result }: { result: Analysis }) {
  return <details className="advanced analysis-timing"><summary>Analysis timings</summary><p className="muted small">Measured on this run; timings are not a detection result.</p><div className="facts">{Object.entries(result.durations_ms).map(([name, value]) => <span key={name}>{name.replaceAll("_", " ")} <b>{value.toFixed(3)} ms</b></span>)}</div></details>;
}
