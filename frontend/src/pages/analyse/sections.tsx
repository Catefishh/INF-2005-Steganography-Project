import type { Analysis, BpcsMetrics, ChiSquareDetails } from "../../api";
import { ChartViewer, ChiStrip, Disclosure, Icon, Panel, Stat } from "../../components";

function Capacity({ metrics }: { metrics: BpcsMetrics }) {
  return <>{metrics.capacity_bits.toLocaleString()} bits ({metrics.capacity_bytes_floor.toLocaleString()} whole bytes + {metrics.capacity_remainder_bits} bits)</>;
}

export function BpcsSection({ result, busy }: { result: Analysis; busy: boolean }) {
  const bpcs = result.bpcs;
  return (
    <Panel title="BPCS complexity segmentation" aria-busy={busy}
      subtitle="Image bit planes are grouped into blocks. These measurements do not identify whether data was hidden.">
      {!bpcs.supported ? (
        <div className="note note-warn"><Icon name="info" /><span>{bpcs.reason} Visual and statistical audio analysis remains available above.</span></div>
      ) : (
        <>
          <div className="facts">
            <span>Channel <b>{result.channel_names[bpcs.config.channel]}</b></span>
            <span>Block size <b>{bpcs.config.block_size} × {bpcs.config.block_size}</b></span>
            <span>Bit planes <b>{bpcs.config.bit_plane_start}–{bpcs.config.bit_plane_end}</b></span>
            <span>Complexity threshold <b>{bpcs.config.complexity_threshold}</b></span>
          </div>
          <div className="stats">
            <Stat label="Complex blocks" value={`${bpcs.summary.complex_blocks.toLocaleString()} of ${bpcs.summary.block_count.toLocaleString()}`} sub={`${bpcs.summary.complex_percent.toFixed(1)}% of selected blocks`} />
            <Stat label="Transitions" value={`${bpcs.summary.transition_count.toLocaleString()} / ${bpcs.summary.possible_transition_count.toLocaleString()}`} />
            <Stat label="Theoretical capacity" value={<Capacity metrics={bpcs.summary} />} sub="Valid pixels of complex blocks; embedding overhead is not deducted." />
          </div>
          <div className="bpcs-planes">
            {bpcs.planes.map((plane) => (
              <figure key={plane.bit_plane}>
                <div className="bpcs-maps">
                  <img src={plane.complexity_map} alt={`Bit ${plane.bit_plane} complexity map`} />
                  <img src={plane.classification_map} alt={`Bit ${plane.bit_plane} complex-block classification map`} />
                </div>
                <figcaption>Bit {plane.bit_plane} · {plane.capacity_bits.toLocaleString()} bits theoretical capacity · {plane.complex_blocks.toLocaleString()} of {plane.block_count.toLocaleString()} blocks complex</figcaption>
              </figure>
            ))}
          </div>
          {bpcs.comparison && (
            <div className="note note-good"><Icon name="layers" /><span>
              Descriptive comparison only; no detector verdict. {bpcs.comparison.summary.changed_blocks.toLocaleString()} blocks changed and {bpcs.comparison.summary.classification_flips.toLocaleString()} classifications flipped.
              {" "}Capacity is {Math.abs(bpcs.comparison.summary.capacity_bits_delta).toLocaleString()} bits {bpcs.comparison.summary.capacity_bits_delta >= 0 ? "more" : "less"} than the reference in the selected planes.
            </span></div>
          )}
        </>
      )}
    </Panel>
  );
}

export function ChiSquareSection({ details, busy }: { details: ChiSquareDetails; busy: boolean }) {
  const interpretable = details.segments.filter((segment) => segment.interpretable).length;
  return (
    <Panel title="Chi-square pairs-of-values" aria-busy={busy}
      subtitle="Each bar covers one section in embedding order. Equalised neighbouring values can result from random LSB replacement or other causes.">
      <ChartViewer title="Chi-square p-values by section" footer={<>
        {interpretable === 0 && <p className="field-hint">No section has enough value pairs for a reliable p-value. Try a larger file; the whole-channel result below may still be interpretable.</p>}
        <div className="legend">
          <span><i style={{ background: "var(--teal)" }} /> p &lt; 0.5</span>
          <span><i style={{ background: "var(--amber)" }} /> 0.5 to 0.95</span>
          <span><i style={{ background: "var(--coral)" }} /> p ≥ {details.presentation_heuristic.toFixed(2)} presentation heuristic</span>
        </div>
      </>}>
        <ChiStrip values={details.segments.map((segment) => segment.p_value)} segments={details.segments} threshold={details.presentation_heuristic} />
      </ChartViewer>
      <div className="stats">
        <Stat label="Whole channel p" value={details.overall.p_value === null ? "not interpretable" : details.overall.p_value.toFixed(4)} />
        <Stat label="Interpretable sections" value={`${interpretable} of ${details.segments.length}`} />
        <Stat label="Valid value pairs" value={details.overall.valid_category_count.toLocaleString()} />
        <Stat label="Samples" value={details.overall.sample_count.toLocaleString()} />
        <Stat label="Statistic" value={details.overall.statistic === null ? "—" : details.overall.statistic.toFixed(3)} />
      </div>
      {!details.overall.interpretable && <p className="field-hint">{details.overall.reason}</p>}
      <p className="field-hint">{details.explanation.high_p_value}</p>
      <ul className="analysis-limitations">{details.explanation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    </Panel>
  );
}

export function AnalysisTiming({ result }: { result: Analysis }) {
  return (
    <Disclosure title="Analysis timings" value="measured on this run">
      <p className="field-hint">Measured on this run; timings are not a detection result.</p>
      <div className="facts">{Object.entries(result.durations_ms).map(([name, duration]) => (
        <span key={name}>{name.replaceAll("_", " ")} <b>{duration.toFixed(3)} ms</b></span>
      ))}</div>
    </Disclosure>
  );
}
