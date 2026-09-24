import { useState } from "react";
import { artifactUrl, requestJson, type Job } from "../api/jobs";
import type { Scenario } from "../api";
import { errorText } from "../util";

type Result = {cases: Scenario[]; generated?: {id: string; filename: string}};

export function TextShowcase({back, onWorkingFile}: {back: () => void; onWorkingFile?: (file: File | null) => void}) {
  const [mode, setMode] = useState<"test" | "encode">("test");
  const [carrier, setCarrier] = useState<File | null>(null);
  const [recovery, setRecovery] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [method, setMethod] = useState("acrostic");
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState("");
  const [jobId, setJobId] = useState("");
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState({completed: 0, total: 5});
  const [rows, setRows] = useState<Scenario[]>([]);
  const [generated, setGenerated] = useState<{id: string; filename: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true); setRows([]); setGenerated(null); setError("");
    try {
      await requestJson("/api/v2/session", {method: "POST"});
      const form = new FormData(); form.append("mode", mode); form.append("public_key", publicKey);
      if (mode === "test") {
        if (carrier) form.append("carrier", carrier);
        if (recovery) form.append("recovery", recovery);
        form.append("recovery_code", code);
      } else {
        for (const [name, value] of Object.entries({method, message, visible, private_key: privateKey, key_password: keyPassword})) form.append(name, value);
      }
      const started = await requestJson<Job<Result>>("/api/v4/jobs/text-showcase", {method: "POST", body: form});
      setJobId(started.id);
      for (let attempt = 0; attempt < 1200; attempt++) {
        const state = await requestJson<Job<Result> & {cases: Scenario[]; completed: number; total: number}>(`/api/v2/jobs/${encodeURIComponent(started.id)}`);
        setRows(state.cases); setPhase(state.phase); setProgress({completed: state.completed, total: state.total});
        if (state.status === "succeeded") {setRows(state.result?.cases ?? state.cases); setGenerated(state.result?.generated ?? null); break;}
        if (state.status === "failed") throw new Error(state.error?.message || "Text showcase failed");
        if (state.status === "cancelled") break;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } catch (cause) {setError(errorText(cause));}
    finally {setBusy(false);}
  }

  const ready = publicKey && (mode === "test" ? carrier && recovery && code : privateKey && message);
  return <div className="form-column">
    <button className="btn ghost sm" type="button" onClick={back}>Media file tests</button>
    <section className="panel"><h2>Text carrier live showcase</h2>
      <p>Exercise acrostic, whitespace, or zero-width carriers. Hidden message authentication is separate from visible wording.</p>
      <div className="segmented" role="group" aria-label="Text showcase mode">
        <button type="button" className={mode === "test" ? "on" : ""} onClick={() => setMode("test")}>Test protected text</button>
        <button type="button" className={mode === "encode" ? "on" : ""} onClick={() => setMode("encode")}>Encode and test</button>
      </div>
      {mode === "test" ? <>
        <label>Protected text file<input type="file" accept=".txt,text/plain" onChange={(event) => {const file = event.target.files?.[0] ?? null; setCarrier(file); onWorkingFile?.(file);}} /></label>
        <label>Recovery file<input type="file" accept=".stegloc-text" onChange={(event) => setRecovery(event.target.files?.[0] ?? null)} /></label>
        <label>Recovery code<input value={code} onChange={(event) => setCode(event.target.value)} /></label>
      </> : <>
        <label>Method<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="acrostic">Acrostic</option><option value="whitespace">Whitespace</option><option value="zero-width">Zero width</option></select></label>
        <label>Hidden message<textarea value={message} onChange={(event) => setMessage(event.target.value)} /></label>
        <label>Visible wording<textarea value={visible} onChange={(event) => setVisible(event.target.value)} /></label>
        <label>Ed25519 private key<textarea value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} /></label>
        <label>Key password<input type="password" value={keyPassword} onChange={(event) => setKeyPassword(event.target.value)} /></label>
      </>}
      <label>Ed25519 public key<textarea value={publicKey} onChange={(event) => setPublicKey(event.target.value)} /></label>
      <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? "Testing…" : mode === "encode" ? "Encode and test text" : "Test protected text"}</button>
      {error && <p role="alert">{error}</p>}
    </section>
    {jobId && <section className="panel"><h2>Live cases</h2><p role="status">{phase}: {progress.completed} of {progress.total} completed</p>
      {busy && <button className="btn ghost" type="button" onClick={() => void requestJson(`/api/v2/jobs/${encodeURIComponent(jobId)}`, {method: "DELETE"})}>Cancel suite</button>}
      <a className="btn ghost" href={`/api/v4/jobs/${encodeURIComponent(jobId)}/evidence`} download="stegloc-text-evidence.zip">Download evidence ZIP</a>
      {generated && <a className="btn ghost" href={artifactUrl(generated.id)} download={generated.filename}>Download generated carrier</a>}
      <ol>{rows.map((row) => <li key={row.id}><b>{row.title}</b>: expected {row.expected.join(" or ")}; observed {row.verdict}. {row.as_expected ? "As expected." : "Unexpected."}</li>)}</ol>
    </section>}
  </div>;
}
