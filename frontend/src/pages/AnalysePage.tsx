import { useEffect, useRef, useState } from "react";
import { api, type Analysis } from "../api";
import { DropZone, ErrorNote, Icon, Panel, Spinner } from "../components";
import { errorText, type Handoff } from "../util";
import { AnalysisTiming, BpcsSection, BitPlanesSection, ChiSquareSection, DifferenceSection, HistogramSection } from "./analyse/sections";
import { appendBpcsForm, DEFAULT_BPCS_FORM, type BpcsForm, validateBpcsForm, bpcsFormFromConfig } from "./analyse/model";

export function AnalysePage({ handoff }: { handoff: Handoff | null }) {
  const [suspect, setSuspect] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [channel, setChannel] = useState(0);
  const [bpcsForm, setBpcsForm] = useState<BpcsForm>({ ...DEFAULT_BPCS_FORM });
  const [appliedBpcsForm, setAppliedBpcsForm] = useState<BpcsForm>({ ...DEFAULT_BPCS_FORM });
  const [bpcsError, setBpcsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (handoff) {
      requestId.current += 1;
      setBusy(false);
      setSuspect(handoff.stego);
      setReference(handoff.cover);
      setResult(null);
      setError("");
      setBpcsError("");
    }
  }, [handoff]);

  function changedFile(setter: (file: File | null) => void, file: File | null) {
    requestId.current += 1;
    setBusy(false);
    setter(file);
    setResult(null);
    setError("");
    setBpcsError("");
  }

  async function run(selected = channel, settings = bpcsForm, validateDraft = true) {
    if (!suspect) return;
    const validation = validateDraft ? validateBpcsForm(settings) : "";
    if (validation) {
      setBpcsError(validation);
      return;
    }
    if (validateDraft) setAppliedBpcsForm(settings);
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
      if (id === requestId.current) setResult(next);
    } catch (exception) {
      if (id === requestId.current) setError(errorText(exception));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  function updateBpcs(key: keyof BpcsForm, value: string) {
    setBpcsForm((current) => ({ ...current, [key]: value }));
    setBpcsError("");
  }

  const applyResult = result?.bpcs.supported ? result.bpcs.config : null;

  return <div className="page-grid">
    <Panel step="1" title="Files to analyse" subtitle="Visual, statistical, and image-only BPCS steganalysis. Add the original cover for descriptive differences." aside={<button type="button" className="btn primary" disabled={!suspect || busy} onClick={() => void run()}>{busy ? <Spinner /> : <Icon name="layers" />} Analyse</button>}>
      <div className="columns"><DropZone title="Suspected stego file" hint="image or WAV" accept="image/*,.wav" icon="eye" file={suspect} onFile={(file) => changedFile(setSuspect, file)} /><DropZone title="Original cover (optional)" hint="same format and size, for comparisons" accept="image/*,.wav" icon="image" file={reference} onFile={(file) => changedFile(setReference, file)} /></div>
      <fieldset className="analysis-settings" disabled={busy || result?.info.kind === "audio"}><legend>BPCS image settings</legend><div className="inline-fields">
        <label>Channel<select value={bpcsForm.channel} onChange={(event) => updateBpcs("channel", event.target.value)}><option value="0">Red</option><option value="1">Green</option><option value="2">Blue</option></select></label>
        <label>Block size<select value={bpcsForm.blockSize} onChange={(event) => updateBpcs("blockSize", event.target.value)}>{[2, 4, 8, 16, 32, 64].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>First plane<input type="number" min="0" max="7" value={bpcsForm.bitPlaneStart} onChange={(event) => updateBpcs("bitPlaneStart", event.target.value)} /></label>
        <label>Last plane<input type="number" min="0" max="7" value={bpcsForm.bitPlaneEnd} onChange={(event) => updateBpcs("bitPlaneEnd", event.target.value)} /></label>
        <label>Complexity threshold<input type="number" min="0" max="1" step="0.01" value={bpcsForm.complexityThreshold} onChange={(event) => updateBpcs("complexityThreshold", event.target.value)} /></label>
        <button type="button" className="btn ghost" disabled={!suspect || busy} onClick={() => void run(channel, bpcsForm, true)}>Apply BPCS settings and rerun</button>
      </div></fieldset>
      {result?.info.kind === "audio" && <p className="muted small">BPCS settings apply to images only.</p>}
      <ErrorNote text={error || bpcsError} />
    </Panel>
    {result && <>
      <BitPlanesSection result={result} busy={busy} onChannel={(next) => { setChannel(next); void run(next, appliedBpcsForm, false); }} />
      <BpcsSection result={result} busy={busy} />
      <div className="columns"><ChiSquareSection details={result.chi_square_details} busy={busy} /><HistogramSection result={result} busy={busy} /></div>
      <DifferenceSection result={result} busy={busy} />
      <AnalysisTiming result={result} />
      {applyResult && <span className="sr-only">Applied BPCS configuration: {bpcsFormFromConfig(applyResult).complexityThreshold}</span>}
    </>}
  </div>;
}
