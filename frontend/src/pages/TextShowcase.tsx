import { useState } from "react";
import { requestJson, type Job } from "../api/jobs";
import type { Scenario } from "../api";
import { errorText } from "../util";
import { DropZone, KeyField } from "../components";
import { artifactUrl } from "../api/jobs";

type Result = {cases: Scenario[]};

export function TextShowcase({back, onWorkingFile, onCarrierChange, onRecoveryChange, onCodeChange, onPublicKeyChange, initialCarrier, initialRecovery, initialCode = "", initialPublicKey = ""}: {
  back: () => void; onWorkingFile?: (file: File | null) => void; initialCarrier?: File | null; initialRecovery?: File | null;
  onCarrierChange?: (file: File | null) => void; onRecoveryChange?: (file: File | null) => void; onCodeChange?: (value: string) => void; onPublicKeyChange?: (value: string) => void;
  initialCode?: string; initialPublicKey?: string;
}) {
  const [carrier, setCarrier] = useState<File | null>(initialCarrier ?? null);
  const [recovery, setRecovery] = useState<File | null>(initialRecovery ?? null);
  const [recoveryCodeFile, setRecoveryCodeFile] = useState<File | null>(null);
  const [code, setCode] = useState(initialCode);
  const [publicKey, setPublicKey] = useState(initialPublicKey);
  const [jobId, setJobId] = useState("");
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState({completed: 0, total: 5});
  const [rows, setRows] = useState<Scenario[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true); setRows([]); setError("");
    try {
      await requestJson("/api/v2/session", {method: "POST"});
      const form = new FormData(); form.append("public_key", publicKey);
      if (carrier) form.append("carrier", carrier);
      if (recovery) form.append("recovery", recovery);
      form.append("recovery_code", code);
      const started = await requestJson<Job<Result>>("/api/v4/jobs/text-showcase", {method: "POST", body: form});
      setJobId(started.id);
      for (let attempt = 0; attempt < 1200; attempt++) {
        const state = await requestJson<Job<Result> & {cases: Scenario[]; completed: number; total: number}>(`/api/v2/jobs/${encodeURIComponent(started.id)}`);
        setRows(state.cases); setPhase(state.phase); setProgress({completed: state.completed, total: state.total});
        if (state.status === "succeeded") {setRows(state.result?.cases ?? state.cases); break;}
        if (state.status === "failed") throw new Error(state.error?.message || "Text showcase failed");
        if (state.status === "cancelled") break;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } catch (cause) {setError(errorText(cause));}
    finally {setBusy(false);}
  }

  const ready = Boolean(publicKey && carrier && recovery && code);
  const planned = [
    { group: "Baseline", items: ["Unchanged carrier", "Original recovery materials"] },
    { group: "Credential changes", items: ["Wrong recovery code", "Wrong public key"] },
    { group: "Carrier edits", items: ["Remove or alter hidden characters", "Change visible carrier text"] },
  ];
  return <div className="form-column">
    <button className="btn ghost sm" type="button" onClick={back}>Protect &amp; verify</button>
    <section className="panel"><div className="panel-titles"><h2>Text tamper tests</h2><p>Run a predictable suite against the protected carrier. Each test uses a separate copy.</p></div>
      <div className="text-readiness"><strong>{ready ? "Inputs ready" : "Complete the inputs"}</strong><span>{carrier?.name ?? "Carrier not selected"} · {recovery?.name ?? "Recovery file not selected"}</span></div>
      <div className="tamper-checklist">
        {planned.map((section) => <div className="tamper-check-group" key={section.group}><h3>{section.group}</h3><ul>{section.items.map((item) => <li key={item}><span className="check-mark" aria-hidden="true">✓</span>{item}</li>)}</ul></div>)}
      </div>
       <div className="text-test-inputs">
         <DropZone label="Protected text file" title="Choose protected text file" hint="Drop or choose a .txt carrier" accept=".txt,text/plain" file={carrier}
            onFile={(file) => {setCarrier(file); onCarrierChange?.(file); onWorkingFile?.(file);}} />
         <DropZone label="Recovery file" title="Choose recovery file" hint="Drop or choose a .stegloc-text file" accept=".stegloc-text" file={recovery}
            onFile={(file) => {setRecovery(file); onRecoveryChange?.(file);}} />
       </div>
         <div className="recovery-code-input">
           <div className="field"><label htmlFor="text-showcase-code">Recovery code</label><input id="text-showcase-code" value={code} placeholder="Paste the code from the text protection step" onChange={(event) => {setCode(event.target.value); onCodeChange?.(event.target.value);}} /><span className="field-hint">Keep this separate from the carrier and recovery file.</span></div>
          <DropZone label="Recovery code file" title="Drop recovery-code.txt" hint="or click to upload the downloaded code" accept=".txt,text/plain" file={recoveryCodeFile}
            onFile={(file) => { setRecoveryCodeFile(file); if (!file) return; void file.text().then((value) => { setCode(value.trim()); onCodeChange?.(value.trim()); }); }} />
        </div>
        <KeyField label="Ed25519 public key" value={publicKey} onChange={(value) => {setPublicKey(value); onPublicKeyChange?.(value);}}
         placeholder="-----BEGIN PUBLIC KEY----- (load sender.pem or paste it)" />
       <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={() => void run()}>{busy ? "Running the tests…" : "Run text tamper tests"}</button>
      {error && <p role="alert">{error}</p>}
    </section>
    {jobId && <section className="panel"><h2>Test results</h2><p role="status">{phase}: {progress.completed} of {progress.total} completed</p>
      {busy && <button className="btn ghost" type="button" onClick={() => void requestJson(`/api/v2/jobs/${encodeURIComponent(jobId)}`, {method: "DELETE"})}>Cancel suite</button>}
      <a className="btn ghost" href={`/api/v4/jobs/${encodeURIComponent(jobId)}/evidence`} download="stegloc-text-evidence.zip">Download evidence ZIP</a>
        <div className="text-test-results">{rows.map((row) => <details className={`text-test-result ${row.as_expected ? "passed" : "failed"}`} key={row.id}>
          <summary><span>{row.as_expected ? "✓" : "!"}</span><b>{row.title}</b><em>{row.as_expected ? "As expected" : "Unexpected"}</em><strong>{row.verdict}</strong></summary>
          <div className="text-test-detail">
            <div className="result-detail-grid">
              <section><span className="result-detail-label">Change applied</span><p>{row.change || "No changes made; this is the untouched baseline."}</p></section>
              <section><span className="result-detail-label">Expected outcome</span><p>{row.expected.join(" or ")}</p></section>
              <section><span className="result-detail-label">Observed verdict</span><p><strong>{row.verdict}</strong></p></section>
              <section><span className="result-detail-label">Verification explanation</span><p>{row.summary || "The job returned no additional explanation."}</p></section>
            </div>
            {row.stages && row.stages.length > 0 && <section className="result-stages"><span className="result-detail-label">Verification stages</span><ol>{row.stages.map((stage) => <li key={stage.id}><code>{stage.id}</code><span>{stage.status}</span></li>)}</ol></section>}
            <div className="result-footer">
              {row.elapsed_ms !== undefined && <span>Completed in {row.elapsed_ms.toLocaleString()} ms</span>}
              {row.payload_hash && <span>Payload hash: {row.payload_hash.status ?? "not available"}</span>}
              {row.file && <a className="btn ghost sm" href={artifactUrl(row.file.id)} download={row.file.filename}>Download {row.file.filename}</a>}
            </div>
          </div>
        </details>)}</div>
    </section>}
  </div>;
}
