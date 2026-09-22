import { useEffect, useRef, useState } from "react";
import { api, type Analysis } from "../api";
import { channelLabel, chiCounts, evidenceReading, inspectCopy, valueRange } from "../analysis";
import { ActionBar, ChiStrip, DropZone, EmptyState, ErrorNote, Histogram, Icon, Metric, Outcome, Panel, Spinner } from "../components";
import { inspectMissing } from "../requirements";
import { errorText, type Handoff } from "../util";

const IMAGE_COLORS = ["#e5483a", "#1f9d55", "#2f6fdb"];

const SUSPECT_SLOT_ID = "inspect-file-slot";
const REFERENCE_SLOT_ID = "inspect-reference-slot";

export function AnalysePage({ handoff }: { handoff: Handoff | null }) {
  const [suspect, setSuspect] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [channel, setChannel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const outcomeRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!handoff) return;
    setSuspect(handoff.stego);
    setReference(handoff.cover);
    setResult(null);
  }, [handoff]);

  async function run(selected = channel) {
    if (!suspect) return;
    setBusy(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("file", suspect, suspect.name);
    if (reference) form.append("compare", reference, reference.name);
    form.append("channel", String(selected));
    try {
      setResult(await api.analyse(form));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
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
        subtitle="The file to inspect on its own. Add the original it was made from to get an exact answer instead of a statistical one.">
        <div className="columns">
          <DropZone label={<>File to inspect <span className="req">· required</span></>} id={SUSPECT_SLOT_ID}
            title="Drop the file here" hint="picture or WAV" accept="image/*,.wav" icon="eye" file={suspect}
            onFile={(file) => { setSuspect(file); setResult(null); }} />
          <DropZone label={<>Original, before anything was hidden <span className="opt">(optional)</span></>} id={REFERENCE_SLOT_ID}
            title="Drop the original here" hint="same size — lets the app show exactly what changed"
            accept="image/*,.wav" icon="image" file={reference}
            onFile={(file) => { setReference(file); setResult(null); }} />
        </div>
        <ErrorNote text={error} />
      </Panel>

      <ActionBar missing={missing}
        heading={ready ? "Ready" : undefined}
        detail={ready
          ? reference
            ? "The original is supplied, so the comparison will be exact."
            : "Without the original the app can only report statistics, not an exact answer."
          : undefined}>
        {(reasonId) => (
          <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={() => void run()}
            aria-describedby={reasonId} aria-busy={busy}>
            {busy ? <Spinner /> : <Icon name="layers" />} {busy ? "Inspecting…" : "Inspect file"}
          </button>
        )}
      </ActionBar>
      <p className="sr-live" role="status" aria-live="polite">
        {busy ? "Splitting the file into bit layers and running the statistical test." : ""}
      </p>

      {!result && (
        <EmptyState icon="layers" title="You will get five pieces of evidence">
          <p>
            A reading of what the figures add up to, an exact map of what changed if you supply the original, a
            statistical test per section of the file, the eight bit layers as images, and a value histogram.
          </p>
          <p className="muted small">
            None of this needs the password or a key. It is what an outsider could work out from the file alone.
          </p>
        </EmptyState>
      )}

      {result && <InspectResult analysis={result} busy={busy} channel={channel} outcomeRef={outcomeRef}
        onChannel={(index) => { setChannel(index); void run(index); }} />}
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
  const chi = chiCounts(analysis);
  const compare = analysis.compare;
  const range = valueRange(analysis.info);
  const strideNote = analysis.stride > 1 ? ` (${copy.strideNote(analysis.stride)})` : "";

  return (
    <>
      <div>
        <Outcome tone={reading.tone === "flat" ? "flat" : reading.tone} icon={reading.tone === "good" ? "shield" : "alert"}
          label="Reading of the evidence" title={reading.headline} summary={reading.summary} headingRef={outcomeRef} />
        <p className="field-hint reading-note">
          This reading is assembled from the figures on this page. It states what they are consistent with, not a certainty.
        </p>
      </div>

      {compare && <DiffPanel analysis={analysis} />}

      <div className="columns">
        <Panel title="Statistical test"
          subtitle="Each bar is one section of the file, in the order data would be written. A high bar means the value pairs (2i, 2i+1) have been evened out, which is what writing random encrypted bits into the lowest bit does.">
          <ChiStrip values={analysis.chi_square} />
          <div className="legend">
            <span><i style={{ background: "var(--teal)" }} /> under 0.5 — looks natural</span>
            <span><i style={{ background: "var(--amber)" }} /> 0.5 to 0.95 — unclear</span>
            <span><i style={{ background: "var(--coral)" }} /> 0.95 and over — looks embedded</span>
          </div>
          <div className="metrics two">
            <Metric label="Per section" value={`${chi.flagged} of ${chi.total}`} tone={chi.flagged ? "warn" : "good"}
              reading={`${chi.flagged === chi.total && chi.total > 0 ? "Every" : chi.flagged === 0 ? "No" : `${chi.flagged}`} section${chi.total === 1 ? "" : "s"} scored 0.95 or above when measured on its own.`} />
            <Metric label="Whole file at once" value={chi.overall === null ? "not enough data" : chi.overall.toFixed(4)}
              reading="The same test applied to the file as one block." />
          </div>
          {chi.flagged > 0 && (
            <div className="note note-warn">
              <Icon name="alert" size={16} />
              <span>
                <b>Read this one with care.</b> {chi.flagged} of {chi.total} sections are flagged, while the whole-file
                figure is {chi.overall === null ? "not available" : chi.overall.toFixed(4)}. Very flat or very noisy files
                make this test say "embedded" whether or not anything is. On 16-bit or deeper audio the lowest byte is
                already noise-like, so the test is only indicative there.{" "}
                {compare ? "The exact comparison above is the stronger signal." : "Supplying the original is what turns this into an exact answer."}
              </span>
            </div>
          )}
        </Panel>

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
            <p className="field-hint">The band where all three channels turn to even static is where the hidden data sits.</p>
          </Panel>
        )}
      </div>
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
            ? `${percent < 0.1 ? "Under 0.1" : percent.toFixed(1)}% of the file. ${oneBitPerValue ? "One bit per value, which is what hiding data changes." : `${compare.bits_changed.toLocaleString()} bits in total.`}`
            : "The file is identical to the original at every value."} />
        <Metric label="Largest change" value={`±${compare.max_difference}`}
          tone={compare.max_difference > 1 ? "bad" : ""}
          reading={compare.max_difference <= 1
            ? "Consistent with one bit per value. Editing or re-saving gives much larger differences."
            : "Too large for one bit per value, so this is editing or re-saving rather than hiding data."} />
        <Metric label={analysis.info.kind === "audio" ? "Audible change" : "Visible change"}
          value={compare.psnr_db === null ? "None" : `${compare.psnr_db.toFixed(2)} dB`}
          reading={`PSNR, with an MSE of ${compare.mse.toExponential(2)}. ${compare.psnr_db === null ? "The two files are identical." : compare.psnr_db >= 40 ? "Too small to notice." : "Large enough to see or hear."}`} />
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
