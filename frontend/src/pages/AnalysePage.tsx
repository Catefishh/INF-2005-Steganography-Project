import { useEffect, useRef, useState } from "react";
import { api, type Analysis } from "../api";
import { channelLabel, evidenceReading, inspectCopy, valueRange } from "../analysis";
import { ActionBar, DropZone, EmptyState, ErrorNote, Histogram, Icon, Metric, Outcome, Panel, Spinner } from "../components";
import { inspectMissing } from "../requirements";
import { errorText, type Handoff } from "../util";
import { AnalysisTiming, BpcsSection, ChiSquareSection } from "./analyse/sections";
import { appendBpcsForm, DEFAULT_BPCS_FORM, type BpcsForm, validateBpcsForm } from "./analyse/model";

const IMAGE_COLORS = ["#e5483a", "#1f9d55", "#2f6fdb"];

const SUSPECT_SLOT_ID = "inspect-file-slot";
const REFERENCE_SLOT_ID = "inspect-reference-slot";

export function AnalysePage({ handoff }: { handoff: Handoff | null }) {
  const [suspect, setSuspect] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [channel, setChannel] = useState(0);
  const [draftBpcs, setDraftBpcs] = useState<BpcsForm>({ ...DEFAULT_BPCS_FORM });
  const [appliedBpcs, setAppliedBpcs] = useState<BpcsForm>({ ...DEFAULT_BPCS_FORM });
  const [bpcsError, setBpcsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const outcomeRef = useRef<HTMLHeadingElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!handoff) return;
    requestId.current += 1;
    setBusy(false);
    setSuspect(handoff.stego);
    setReference(handoff.cover);
    setResult(null);
    setError("");
    setBpcsError("");
  }, [handoff]);

  function changeFile(file: File | null, which: "suspect" | "reference") {
    requestId.current += 1;
    setBusy(false);
    if (which === "suspect") setSuspect(file);
    else setReference(file);
    setResult(null);
    setError("");
    setBpcsError("");
  }

  function updateBpcs(key: keyof BpcsForm, value: string) {
    setDraftBpcs((current) => ({ ...current, [key]: value }));
    setBpcsError("");
  }

  async function run(selected = channel, settings = appliedBpcs, apply = false) {
    if (!suspect) return;
    if (apply) {
      const validation = validateBpcsForm(settings);
      if (validation) {
        setBpcsError(validation);
        return;
      }
    }
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", suspect, suspect.name);
    if (reference) form.append("compare", reference, reference.name);
    form.append("channel", String(selected));
    appendBpcsForm(form, settings);
    try {
      const next = await api.analyse(form);
      if (id === requestId.current) {
        setResult(next);
        if (apply) setAppliedBpcs(settings);
      }
    } catch (e) {
      if (id === requestId.current) setError(errorText(e));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  // The reading is an outcome, so it is announced and takes focus when it appears.
  useEffect(() => {
    if (result) outcomeRef.current?.focus();
  }, [result]);

  const missing = inspectMissing({ hasFile: suspect !== null });
  const ready = missing.length === 0;

  return (
    <div className="form-column">
      <Panel step="1" title="Files to compare"
        subtitle="Inspect a file alone or add a matching original to measure differences directly. These observations cannot prove embedding or authenticity.">
        <div className="columns">
          <DropZone label={<>File to inspect <span className="req">· required</span></>} id={SUSPECT_SLOT_ID}
            title="Drop the file here" hint="picture or WAV" accept="image/*,.wav" icon="eye" file={suspect}
            onFile={(file) => changeFile(file, "suspect")} />
          <DropZone label={<>Original, before anything was hidden <span className="opt">(optional)</span></>} id={REFERENCE_SLOT_ID}
            title="Drop the original here" hint="same format and size — reveals measured differences"
            accept="image/*,.wav" icon="image" file={reference}
            onFile={(file) => changeFile(file, "reference")} />
        </div>
        <fieldset className="analysis-settings" disabled={busy || result?.info.kind === "audio"}>
          <legend>BPCS image settings</legend>
          <div className="inline-fields">
            <label>Channel<select value={draftBpcs.channel} onChange={(event) => updateBpcs("channel", event.target.value)}>
              <option value="0">Red</option><option value="1">Green</option><option value="2">Blue</option>
            </select></label>
            <label>Block size<select value={draftBpcs.blockSize} onChange={(event) => updateBpcs("blockSize", event.target.value)}>
              {[2, 4, 8, 16, 32, 64].map((size) => <option key={size} value={size}>{size}</option>)}
            </select></label>
            <label>First plane<input type="number" min="0" max="7" value={draftBpcs.bitPlaneStart}
              onChange={(event) => updateBpcs("bitPlaneStart", event.target.value)} /></label>
            <label>Last plane<input type="number" min="0" max="7" value={draftBpcs.bitPlaneEnd}
              onChange={(event) => updateBpcs("bitPlaneEnd", event.target.value)} /></label>
            <label>Complexity threshold<input type="number" min="0" max="1" step="0.01" value={draftBpcs.complexityThreshold}
              onChange={(event) => updateBpcs("complexityThreshold", event.target.value)} /></label>
          </div>
          <button type="button" className="btn ghost" disabled={!ready || busy}
            onClick={() => void run(channel, draftBpcs, true)}>Apply BPCS settings and rerun</button>
          <ErrorNote text={bpcsError} />
        </fieldset>
        {result?.info.kind === "audio" && <p className="field-hint">BPCS settings apply to images only.</p>}
        <ErrorNote text={error} />
      </Panel>

      <ActionBar missing={missing}
        heading={ready ? "Ready" : undefined}
        detail={ready
          ? reference
            ? "The original is supplied, so differences can be measured directly."
            : "Without the original the app reports statistical and visual patterns only."
          : undefined}>
        {(reasonId) => (
          <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={() => void run()}
            aria-describedby={reasonId} aria-busy={busy}>
            {busy ? <Spinner /> : <Icon name="layers" />} {busy ? "Inspecting…" : "Inspect file"}
          </button>
        )}
      </ActionBar>
      <p className="sr-live" role="status" aria-live="polite">
        {busy ? "Analysing bit layers, pair counts and image block complexity." : ""}
      </p>

      {!result && (
        <EmptyState icon="layers" title="Inspect patterns and measured differences">
          <p>
            Inspect value-pair statistics, the eight bit layers and a histogram. Images also include BPCS complexity
            maps and capacity estimates. With an original, compare measured differences directly.
          </p>
          <p className="muted small">
            None of this needs the password or a key. It is what an outsider could work out from the file alone.
          </p>
        </EmptyState>
      )}

      {result && <InspectResult analysis={result} busy={busy} channel={channel} outcomeRef={outcomeRef}
        onChannel={(index) => { setChannel(index); void run(index, appliedBpcs); }} />}
    </div>
  );
}

/**
 * Results in the order of the strength of the evidence: the reading, then the exact difference,
 * then the statistical test, then the bit layers, then the histogram.
 */
function InspectResult({ analysis, busy, channel, outcomeRef, onChannel }: {
  analysis: Analysis;
  busy: boolean;
  channel: number;
  outcomeRef: React.RefObject<HTMLHeadingElement | null>;
  onChannel: (index: number) => void;
}) {
  const kind = analysis.info.kind;
  const copy = inspectCopy(kind);
  const reading = evidenceReading(analysis);
  const compare = analysis.compare;
  const range = valueRange(analysis.info);
  const strideNote = analysis.stride > 1 ? ` (${copy.strideNote(analysis.stride)})` : "";

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
        <ChiSquareSection details={analysis.chi_square_details} busy={busy} />

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
            {channelLabel(analysis)}{strideNote}. {copy.planesNote}
          </p>
          <div className="planes">
            {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => (
              <figure key={bit} className={bit < 2 ? "low" : ""}>
                <img src={analysis.bit_planes[bit]} alt={`Bit plane ${bit}`} />
                <figcaption>Bit {bit}{bit === 7 ? " · top" : bit === 0 ? " · bottom" : ""}</figcaption>
              </figure>
            ))}
          </div>
          {kind === "audio" && (
            <p className="muted small">
              Audio samples are laid out row by row as a square image, one pixel per sample of the chosen channel.
            </p>
          )}
        </Panel>
      </div>

      <div className="columns">
        <Panel title="Value histogram"
          subtitle="Replacing the lowest bit makes neighbouring pairs of bars the same height. Look for the comb pattern flattening out.">
          <Histogram series={analysis.histograms} colors={kind === "image" ? IMAGE_COLORS : ["#0fa3a3"]} />
          <div className="axis">
            <span>{range.min}</span><span>{copy.histogramAxis}</span><span>{range.max}</span>
          </div>
        </Panel>

        {analysis.lsb_composite && (
          <Panel title="Lowest bit of red, green and blue as one image">
            <figure className="composite">
              <img src={analysis.lsb_composite} alt="The lowest bit of red, green and blue, shown as a colour image" />
            </figure>
            <p className="field-hint">Even-looking regions can have several causes; use the maps as descriptive evidence.</p>
          </Panel>
        )}
      </div>
      <BpcsSection result={analysis} busy={busy} />
      <AnalysisTiming result={analysis} />
    </>
  );
}

/** The panel that only an exact comparison can produce: what changed, where, and by how much. */
function DiffPanel({ analysis }: { analysis: Analysis }) {
  const compare = analysis.compare!;
  const copy = inspectCopy(analysis.info.kind);
  const percent = analysis.info.n_slots > 0 ? (compare.slots_changed / analysis.info.n_slots) * 100 : 0;
  const oneBitPerValue = compare.slots_changed > 0 && compare.bits_changed === compare.slots_changed;

  return (
    <Panel title={copy.differenceTitle} subtitle="Every changed value, against the original you supplied.">
      <div className="metrics">
        <Metric label="Values changed" value={<>{compare.slots_changed.toLocaleString()} <small>of {analysis.info.n_slots.toLocaleString()}</small></>}
          tone={compare.slots_changed ? "warn" : "good"}
          reading={compare.slots_changed
            ? `${percent < 0.1 ? "Under 0.1" : percent.toFixed(1)}% of the file. ${oneBitPerValue ? "One bit per value changed, consistent with LSB replacement but not proof of it." : `${compare.bits_changed.toLocaleString()} bits in total.`}`
            : "The file is identical to the original at every value."} />
        <Metric label="Largest change" value={`±${compare.max_difference}`}
          tone={compare.max_difference > 1 ? "bad" : ""}
          reading={compare.max_difference <= 1
            ? "Consistent with one-bit replacement; other causes are possible."
            : "Larger than single-bit replacement alone explains."} />
        <Metric label={analysis.info.kind === "audio" ? "Audible change" : "Visible change"}
          value={compare.psnr_db === null ? "None" : `${compare.psnr_db.toFixed(2)} dB`}
          reading={`PSNR, with an MSE of ${compare.mse.toExponential(2)}. ${compare.psnr_db === null ? "Analysed values match." : "Perceptibility depends on the carrier and viewing conditions."}`} />
      </div>

      <div className="planes two">
        <figure>
          <img src={compare.changed_map} alt="The locations that changed" />
          <figcaption>White marks every changed {copy.unit} — {compare.slots_changed.toLocaleString()} in total</figcaption>
        </figure>
        {compare.amplified && (
          <figure>
            <img src={compare.amplified} alt="The changed locations, brightened" />
            <figcaption>The same locations, brightness multiplied 64× so a ±1 change becomes visible</figcaption>
          </figure>
        )}
      </div>
    </Panel>
  );
}
