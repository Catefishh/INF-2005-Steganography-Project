import { useState } from "react";
import { requestJson, type Job } from "../api/jobs";
import type { Scenario } from "../api";
import { errorText } from "../util";

type Result = {cases: Scenario[]};

export function TextShowcase({back, onWorkingFile}: {back: () => void; onWorkingFile?: (file: File | null) => void}) {
  const [carrier, setCarrier] = useState<File | null>(null);
  const [recovery, setRecovery] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [publicKey, setPublicKey] = useState("");
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

  const ready = publicKey && carrier && recovery && code;
  return <div className="form-column">
    <button className="btn ghost sm" type="button" onClick={back}>Media file tests</button>
    <section className="panel"><h2>Text carrier live showcase</h2>
      <p>Exercise acrostic, whitespace, or zero-width carriers. Hidden message authentication is separate from visible wording.</p>
      <label>Protected text file<input type="file" accept=".txt,text/plain" onChange={(event) => {const file = event.target.files?.[0] ?? null; setCarrier(file); onWorkingFile?.(file);}} /></label>
      <label>Recovery file<input type="file" accept=".stegloc-text" onChange={(event) => setRecovery(event.target.files?.[0] ?? null)} /></label>
      <label>Recovery code<input value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label>Ed25519 public key<textarea value={publicKey} onChange={(event) => setPublicKey(event.target.value)} /></label>
      <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? "Testing…" : "Test protected text"}</button>
      {error && <p role="alert">{error}</p>}
    </section>
    {jobId && <section className="panel"><h2>Live cases</h2><p role="status">{phase}: {progress.completed} of {progress.total} completed</p>
      {busy && <button className="btn ghost" type="button" onClick={() => void requestJson(`/api/v2/jobs/${encodeURIComponent(jobId)}`, {method: "DELETE"})}>Cancel suite</button>}
      <a className="btn ghost" href={`/api/v4/jobs/${encodeURIComponent(jobId)}/evidence`} download="stegloc-text-evidence.zip">Download evidence ZIP</a>
      <ol>{rows.map((row) => <li key={row.id}><b>{row.title}</b>: expected {row.expected.join(" or ")}; observed {row.verdict}. {row.as_expected ? "As expected." : "Unexpected."}</li>)}</ol>
    </section>}
  </div>;
}
