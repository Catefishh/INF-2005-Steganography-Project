import { useState } from "react";
import { Panel, ErrorNote } from "../components";
import { errorText } from "../util";

import { runRobustness, type Result } from "../api/robustness";
import { artifactUrl } from "../api/jobs";

export function RobustnessPanel() {
  const [stego, setStego] = useState<File | null>(null);
  const [protocol, setProtocol] = useState("legacy");
  const [passphrase, setPassphrase] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [recovery, setRecovery] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [values, setValues] = useState({ resize: 0.75, crop: 0.9, jpeg: 75, noise: 2, brightness: 1.1 });
  const [result, setResult] = useState<Result | null>(null);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");

  async function run() {
    if (!stego) return;
    setError(""); setResult(null); setPhase("Starting");
    try {
      const form = new FormData();
      form.append("stego", stego); form.append("protocol", protocol); form.append("passphrase", passphrase);
      form.append("public_key", publicKey); form.append("recovery_code", code);
      if (recovery) form.append("recovery", recovery);
      Object.entries(values).forEach(([name, value]) => form.append(name, String(value)));
      const completed = await runRobustness(form, setPhase);
      if (completed) setResult(completed);
    } catch (cause) { setError(errorText(cause)); }
    finally { setPhase(""); }
  }

  return <Panel title="Image robustness simulator" subtitle="Each image edit starts from the same protected file; no edits are chained.">
    <div className="field"><label htmlFor="robust-stego">Protected image</label><input id="robust-stego" type="file" accept="image/png,image/bmp" onChange={(event) => setStego(event.target.files?.[0] ?? null)} /></div>
    <div className="field"><label htmlFor="robust-protocol">Verification workflow</label><select id="robust-protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)}><option value="legacy">Legacy RSA/passphrase</option><option value="v2">V2 Ed25519/recovery file</option></select></div>
    {protocol === "legacy" && <div className="field"><label htmlFor="robust-password">Passphrase</label><input id="robust-password" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></div>}
    {protocol === "v2" && <><div className="field"><label htmlFor="robust-recovery">Recovery file</label><input id="robust-recovery" type="file" onChange={(event) => setRecovery(event.target.files?.[0] ?? null)} /></div>
      <div className="field"><label htmlFor="robust-code">Recovery code</label><input id="robust-code" value={code} onChange={(event) => setCode(event.target.value)} /></div></>}
    <div className="field"><label htmlFor="robust-public">Public key PEM</label><textarea id="robust-public" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} /></div>
    <div className="columns">{Object.entries(values).map(([name, value]) => <div className="field" key={name}><label htmlFor={`robust-${name}`}>{name} {name === "jpeg" ? "quality" : name === "noise" ? "sigma" : "factor"}</label>
      <input id={`robust-${name}`} type="number" step={name === "jpeg" || name === "noise" ? "1" : "0.01"} value={value}
        onChange={(event) => setValues({ ...values, [name]: Number(event.target.value) })} /></div>)}</div>
    <button type="button" className="btn primary" disabled={!stego || !publicKey || Boolean(phase)} onClick={() => void run()}>Run image transformations</button>
    {phase && <p role="status">{phase}</p>}<ErrorNote text={error} />
    {result && <><p className="field-hint">Unmodified baseline: {result.baseline_verdict}. {result.note}</p>
      <div className="robust-grid">{result.scenarios.map((row) => <div className="robust-card" key={row.operation}>
        <h3>{row.operation} · {row.value}</h3>{row.preview && <img src={row.preview} alt={`${row.operation} transformed image`} />}
        <p>Verification: {row.verdict}</p><p>{row.metrics ? `MSE ${row.metrics.mse.toFixed(3)} · PSNR ${row.metrics.psnr_db === null ? "∞" : row.metrics.psnr_db.toFixed(2)} dB · SSIM ${row.metrics.ssim?.toFixed(4) ?? "unavailable"}` : "Direct quality metrics unavailable: dimensions changed."}</p>
        <a href={artifactUrl(row.file.id)} download={row.file.filename}>Download transformed PNG</a>
      </div>)}</div></>}
  </Panel>;
}
