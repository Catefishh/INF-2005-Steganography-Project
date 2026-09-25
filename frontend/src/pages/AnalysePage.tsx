import { useEffect, useRef, useState } from "react";
import { api, type Analysis } from "../api";
import { ActionBar, Disclosure, DropZone, EmptyState, ErrorNote, Icon, Panel, Spinner } from "../components";
import { inspectMissing } from "../requirements";
import { errorText, type Handoff } from "../util";
import { appendBpcsForm, DEFAULT_BPCS_FORM, type BpcsForm, validateBpcsForm } from "./analyse/model";
import { InspectResult } from "./analysis/Results";
import { VideoInspect } from "./VideoInspect";

const SUSPECT_SLOT_ID = "inspect-file-slot";
const REFERENCE_SLOT_ID = "inspect-reference-slot";

export function AnalysePage({ handoff, onWorkingFile }: { handoff: Handoff | null; onWorkingFile?: (file: File | null) => void }) {
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
  const planesRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<"reading" | "planes">("reading");
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
    focusTarget.current = "reading";
  }, [handoff]);

  function changeFile(file: File | null, which: "suspect" | "reference") {
    requestId.current += 1;
    setBusy(false);
    if (which === "suspect") { setSuspect(file); onWorkingFile?.(file); }
    else setReference(file);
    setResult(null);
    setError("");
    setBpcsError("");
    focusTarget.current = "reading";
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
      if (id === requestId.current) {
        focusTarget.current = "reading";
        setError(errorText(e));
      }
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  // Initial results announce the reading; channel reruns keep the image in view instead.
  useEffect(() => {
    if (!result) return;
    if (focusTarget.current === "planes") {
      planesRef.current?.scrollIntoView?.({ block: "start" });
      focusTarget.current = "reading";
    } else outcomeRef.current?.focus();
  }, [result]);

  const missing = inspectMissing({ hasFile: suspect !== null });
  const ready = missing.length === 0;

  if (handoff && /\.avi$/i.test(handoff.stego.name)) return <VideoInspect handoff={handoff} />;

  return (
    <div className="form-column">
      <Panel step="1" title="Files to compare"
        subtitle="Inspect a file alone or add a matching original to measure differences directly. These observations cannot prove embedding or authenticity.">
        <div className="columns">
          <DropZone label={<>File to inspect <span className="req">· required</span></>} id={SUSPECT_SLOT_ID}
            title="Drop the file here" hint="image, audio, or video" accept="image/*,audio/*,video/*,.wav,.mp3,.mp4,.mov,.avi" icon="eye" file={suspect}
            onFile={(file) => changeFile(file, "suspect")} />
          <DropZone label={<>Original, before anything was hidden <span className="opt">(optional)</span></>} id={REFERENCE_SLOT_ID}
            title="Drop the original here" hint="same format and size — reveals measured differences"
            accept="image/*,audio/*,video/*,.wav,.mp3,.mp4,.mov,.avi" icon="image" file={reference}
            onFile={(file) => changeFile(file, "reference")} />
        </div>
        <Disclosure title="BPCS image settings" value="optional">
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
        </Disclosure>
        {result?.info.kind === "audio" && <p className="field-hint">BPCS settings apply to images only.</p>}
        <ErrorNote text={error} />
      </Panel>

      <ActionBar missing={missing} heading={ready ? "Ready" : undefined}>
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
        </EmptyState>
      )}

      {result && <div className="evidence-arrival"><InspectResult analysis={result} busy={busy} channel={channel}
        outcomeRef={outcomeRef} planesRef={planesRef}
        onChannel={(index) => { focusTarget.current = "planes"; setChannel(index); void run(index, appliedBpcs); }} /></div>}
    </div>
  );
}
