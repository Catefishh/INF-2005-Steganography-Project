import { useEffect, useState } from "react";
import { Panel, ErrorNote } from "../components";
import { errorText, type Handoff } from "../util";
import { api } from "../api";

import { runRobustness, type Result, type Row } from "../api/robustness";
import { artifactUrl } from "../api/jobs";

export function RobustnessPanel({ handoff }: { handoff?: Handoff | null }) {
  const [stego, setStego] = useState<File | null>(null);
  const [stegoFromHandoff, setStegoFromHandoff] = useState(false);
  const [protocol, setProtocol] = useState("legacy");
  const [passphrase, setPassphrase] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [keyFromHandoff, setKeyFromHandoff] = useState(false);

  // Pre-fill from the workspace handoff when it arrives or changes.
  // Only images are supported by the robustness backend (PNG/BMP), so we
  // skip audio/video handoffs rather than pre-filling with an unusable file.
  useEffect(() => {
    if (!handoff) return;
    const name = handoff.stego.name.toLowerCase();
    const isImage = /\.(png|bmp|jpe?g|gif|webp|tiff?)$/i.test(name);
    if (isImage) { setStego(handoff.stego); setStegoFromHandoff(true); }
    if (handoff.passphrase) setPassphrase(handoff.passphrase);
    if (handoff.publicPem) { setPublicKey(handoff.publicPem); setKeyFromHandoff(true); }
  }, [handoff?.id]);

  const [recovery, setRecovery] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [values, setValues] = useState({ resize: 0.75, crop: 0.9, jpeg: 75, noise: 2, brightness: 1.1 });
  const [result, setResult] = useState<Result | null>(null);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");

  // Retest selection: set of operation names the user wants to re-run.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [retestPhase, setRetestPhase] = useState("");
  const [retestError, setRetestError] = useState("");

  function toggleSelected(op: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(op) ? next.delete(op) : next.add(op);
      return next;
    });
  }

  function selectAll() {
    if (!result) return;
    setSelected(new Set(result.scenarios.map((r) => r.operation)));
  }

  function deselectAll() { setSelected(new Set()); }

  async function buildForm(overrideValues?: typeof values) {
    const form = new FormData();
    form.append("stego", stego!); form.append("protocol", protocol); form.append("passphrase", passphrase);
    form.append("public_key", publicKey); form.append("recovery_code", code);
    if (recovery) form.append("recovery", recovery);
    Object.entries(overrideValues ?? values).forEach(([name, value]) => form.append(name, String(value)));
    return form;
  }

  async function run() {
    if (!stego) return;
    setError(""); setResult(null); setPhase("Starting"); setSelected(new Set());
    try {
      const completed = await runRobustness(await buildForm(), setPhase);
      if (completed) setResult(completed);
    } catch (cause) { setError(errorText(cause)); }
    finally { setPhase(""); }
  }

  // Retest: fetches each selected artifact and re-runs cryptographic verification
  // against it using the current credentials. No re-transformation happens.
  async function retest() {
    if (!result || selected.size === 0) return;
    setRetestError(""); setRetestPhase("Verifying…");
    try {
      const updated: Row[] = [...result.scenarios];
      let done = 0;
      for (let i = 0; i < updated.length; i++) {
        const row = updated[i];
        if (!selected.has(row.operation)) continue;
        setRetestPhase(`Verifying ${row.operation} (${done + 1} of ${selected.size})`);
        // Fetch the already-transformed image from the artifact store.
        const response = await fetch(artifactUrl(row.file.id));
        if (!response.ok) throw new Error(`Could not fetch artifact for ${row.operation}`);
        const blob = await response.blob();
        const file = new File([blob], row.file.filename, { type: "image/png" });
        // Build a verify form with the same credentials as the main run.
        const form = new FormData();
        form.append("stego", file, file.name);
        form.append("passphrase", passphrase);
        form.append("public_key", publicKey);
        if (protocol === "v2" && recovery) form.append("recovery", recovery);
        if (protocol === "v2") form.append("recovery_code", code);
        const verifyResult = await api.verify(form);
        updated[i] = { ...row, verdict: verifyResult.verdict };
        done++;
      }
      setResult({ ...result, scenarios: updated });
    } catch (cause) { setRetestError(errorText(cause)); }
    finally { setRetestPhase(""); }
  }

  async function importPublicKey(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 32768) throw new Error("Public key file is too large (maximum 32 KB).");
      setPublicKey(await file.text());
      setKeyFromHandoff(false);
    } catch (cause) { setError(errorText(cause)); }
  }

  const busy = Boolean(phase);
  const retestBusy = Boolean(retestPhase);

  return <Panel title="Image robustness simulator" subtitle="Subjects the protected image to common transformations — resizing, cropping, JPEG compression, noise, and brightness changes — then reruns cryptographic verification to determine whether the hidden payload remains recoverable and authentic. Each edit starts from the original; none are chained.">
    {/* Protected image */}
    <div className="field">
      <label htmlFor="robust-stego">Protected image</label>
      <input id="robust-stego" type="file" accept="image/png,image/bmp,image/jpeg,image/gif,image/webp"
        onChange={(event) => { setStego(event.target.files?.[0] ?? null); setStegoFromHandoff(false); }} />
      {stegoFromHandoff && stego && (
        <small className="field-hint">Using workspace file: <b>{stego.name}</b></small>
      )}
    </div>

    <div className="field"><label htmlFor="robust-protocol">Verification workflow</label>
      <select id="robust-protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)}>
        <option value="legacy">RSA/passphrase (LSB or DCT)</option>
        <option value="v2">V2 Ed25519/recovery file</option>
      </select>
    </div>

    {protocol === "legacy" && <div className="field">
      <label htmlFor="robust-password">Passphrase</label>
      <input id="robust-password" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
    </div>}

    {protocol === "v2" && <>
      <div className="field"><label htmlFor="robust-recovery">Recovery file</label>
        <input id="robust-recovery" type="file" onChange={(event) => setRecovery(event.target.files?.[0] ?? null)} />
      </div>
      <div className="field"><label htmlFor="robust-code">Recovery code</label>
        <input id="robust-code" value={code} onChange={(event) => setCode(event.target.value)} />
      </div>
    </>}

    {/* Public key upload */}
    <div className="field">
      <label htmlFor="robust-public-file">Upload public key PEM</label>
      <input id="robust-public-file" type="file" accept=".pem"
        onChange={(event) => void importPublicKey(event.target.files?.[0])} />
      {keyFromHandoff && publicKey && (
        <small className="field-hint">Using workspace public key.</small>
      )}
    </div>

    <div className="field"><label htmlFor="robust-public">Public key PEM</label>
      <textarea id="robust-public" value={publicKey} onChange={(event) => { setPublicKey(event.target.value); setKeyFromHandoff(false); }} />
    </div>

    <div className="columns">{Object.entries(values).map(([name, value]) =>
      <div className="field" key={name}>
        <label htmlFor={`robust-${name}`}>{name} {name === "jpeg" ? "quality" : name === "noise" ? "sigma" : "factor"}</label>
        <input id={`robust-${name}`} type="number" step={name === "jpeg" || name === "noise" ? "1" : "0.01"} value={value}
          onChange={(event) => setValues({ ...values, [name]: Number(event.target.value) })} />
      </div>
    )}</div>

    <button type="button" className="btn primary" disabled={!stego || !publicKey || busy || retestBusy}
      onClick={() => void run()}>Run image transformations</button>

    {phase && <p role="status">{phase}</p>}
    <ErrorNote text={error} />

    {result && <>
      <p className="field-hint">Unmodified baseline: {result.baseline_verdict}. {result.note}</p>
      <p className="field-hint">A failed verification means that copy of the image could not be verified — it does not necessarily prove that every hidden bit has been physically destroyed.</p>

      {/* Retest controls */}
      <div className="btn-row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span className="field-hint" style={{ marginBottom: 0 }}>
          {selected.size === 0
            ? "Select transforms to retest"
            : `${selected.size} selected`}
        </span>
        <button type="button" className="btn ghost sm" onClick={selectAll} disabled={retestBusy}>Select all</button>
        <button type="button" className="btn ghost sm" onClick={deselectAll} disabled={retestBusy || selected.size === 0}>Deselect all</button>
        <button type="button" className="btn primary sm" disabled={selected.size === 0 || retestBusy || busy}
          onClick={() => void retest()}>
          {retestBusy ? retestPhase : `Retest ${selected.size > 0 ? `(${selected.size})` : "selected"}`}
        </button>
      </div>
      <ErrorNote text={retestError} />

      <div className="robust-grid">
        {result.scenarios.map((row) => {
          const isSelected = selected.has(row.operation);
          return (
            <div className={`robust-card${isSelected ? " robust-card--selected" : ""}`} key={row.operation}>
              <label className="robust-card-select" title="Select for retest">
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(row.operation)} />
                <h3>{row.operation} · {row.value}</h3>
              </label>
              {row.preview && <img src={row.preview} alt={`${row.operation} transformed image`} />}
              <p>Verification: {row.verdict}</p>
              <p>Size: {row.original_dimensions.join(" × ")} → {row.result_dimensions.join(" × ")}</p>
              <a href={artifactUrl(row.file.id)} download={row.file.filename}>Download transformed PNG</a>
            </div>
          );
        })}
      </div>
    </>}
  </Panel>;
}
