import { useEffect, useRef, useState } from "react";
import { api, type Analysis } from "../api";
import { channelLabel, chiCounts, evidenceReading, inspectCopy, valueRange } from "../analysis";
import { ActionBar, ChiStrip, DropZone, EmptyState, ErrorNote, Histogram, Icon, Metric, Outcome, Panel, Spinner } from "../components";
import { inspectMissing } from "../requirements";
import { errorText, type Handoff } from "../util";
import { BpcsPanel } from "./analysis/BpcsPanel";

const IMAGE_COLORS = ["#e5483a", "#1f9d55", "#2f6fdb"];

const SUSPECT_SLOT_ID = "inspect-file-slot";
const REFERENCE_SLOT_ID = "inspect-reference-slot";

export function AnalysePage({ handoff }: { handoff: Handoff | null }) {
  const [suspect, setSuspect] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [channel, setChannel] = useState(0);
  const [blockSize, setBlockSize] = useState(16);
  const [firstPlane, setFirstPlane] = useState(0);
  const [lastPlane, setLastPlane] = useState(3);
  const [threshold, setThreshold] = useState(0.3);
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
    form.append("bpcs_block_size", String(blockSize));
    form.append("bpcs_first_plane", String(firstPlane));
    form.append("bpcs_last_plane", String(lastPlane));
    form.append("bpcs_threshold", String(threshold));
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
        <div className="columns">
          <div className="field"><label htmlFor="bpcs-block">BPCS block size</label>
            <input id="bpcs-block" type="number" min="4" max="64" value={blockSize}
              onChange={(event) => { setBlockSize(Number(event.target.value)); setResult(null); }} /></div>
          <div className="field"><label htmlFor="bpcs-threshold">Complexity threshold (0–1)</label>
            <input id="bpcs-threshold" type="number" min="0" max="1" step="0.05" value={threshold}
              onChange={(event) => { setThreshold(Number(event.target.value)); setResult(null); }} /></div>
          <div className="field"><label htmlFor="bpcs-first">First bit plane</label>
            <input id="bpcs-first" type="number" min="0" max="7" value={firstPlane}
              onChange={(event) => { setFirstPlane(Number(event.target.value)); setResult(null); }} /></div>
          <div className="field"><label htmlFor="bpcs-last">Last bit plane</label>
            <input id="bpcs-last" type="number" min="0" max="7" value={lastPlane}
              onChange={(event) => { setLastPlane(Number(event.target.value)); setResult(null); }} /></div>
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


import { InspectResult } from "./analysis/Results";
