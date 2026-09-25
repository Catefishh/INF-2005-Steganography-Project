import { useEffect, useRef, useState } from "react";
import { artifactUrl, pollJob, requestJson, type Job } from "../api/jobs";
import { HashEvidence, type HashEvidenceData } from "../ui/hashEvidence";
import type { Handoff } from "../util";
import { errorText } from "../util";

type Stored = {id: string; filename: string; size: number; media_type?: string};
type VideoProtected = {carrier: Stored; recovery: Stored; recovery_code: string; payload_hash: HashEvidenceData; record: {content: {sha256: string}}};
type VideoVerified = {verdict: string; stages: Record<string, {status: string; evidence: string; reason: string}>;
  content: Stored | null; payload_hash: HashEvidenceData; download_url?: string | null; attempted_location?: number | null};

async function getFile(stored: Stored): Promise<File> {
  const response = await fetch(artifactUrl(stored.id));
  if (!response.ok) throw new Error("The session artifact expired");
  return new File([await response.blob()], stored.filename, {type: stored.media_type ?? "application/octet-stream"});
}

async function job<T>(path: string, form: FormData, onPhase: (value: string) => void): Promise<T> {
  await requestJson("/api/v2/session", {method: "POST"});
  const started = await requestJson<Job<T>>(path, {method: "POST", body: form});
  const result = await pollJob<T>(started.id, {attempts: 1200, onUpdate: onPhase,
    failed: "Operation failed", cancelled: "Operation cancelled", timeout: "Operation timed out"});
  if (!result) throw new Error("Operation produced no result");
  return result;
}

export function VideoEmbed({ cover, source, conversion, onHandoff, onResultAvailability }: {cover: File; source: File | null; conversion?: Handoff["conversion"]; onHandoff: (value: Handoff) => void; onResultAvailability?: (available: boolean) => void}) {
  const [payload, setPayload] = useState<File | null>(null);
  const [payloadDigest, setPayloadDigest] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [depth, setDepth] = useState(3);
  const [capacity, setCapacity] = useState<{total_bytes: number; maximum_message_bytes: number; fits_at_selected_start: boolean} | null>(null);
  const [result, setResult] = useState<VideoProtected | null>(null);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPayloadDigest("");
    if (!payload) return;
    let live = true;
    payload.arrayBuffer().then((bytes) => crypto.subtle.digest("SHA-256", bytes)).then((digest) => {
      if (live) setPayloadDigest(Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""));
    }).catch(() => undefined);
    return () => {live = false;};
  }, [payload]);

  useEffect(() => {
    if (!payload) {setCapacity(null); return;}
    let live = true;
    const form = new FormData(); form.append("cover", cover); form.append("content_length", String(payload.size));
    form.append("content_name", payload.name); form.append("content_type", payload.type || "application/octet-stream");
    form.append("depth", String(depth));
    requestJson<typeof capacity>("/api/v2/estimate", {method: "POST", body: form})
      .then((value) => {if (live) setCapacity(value);}).catch((cause) => {if (live) setError(errorText(cause));});
    return () => {live = false;};
  }, [cover, payload, depth]);

  async function generateKeys() {
    setError("");
    try {
      const form = new FormData(); form.append("password", keyPassword);
      const pair = await requestJson<{private_key: string; public_key: string}>("/api/v2/keys/generate", {method: "POST", body: form});
      setPrivateKey(pair.private_key); setPublicKey(pair.public_key);
    } catch (cause) {setError(errorText(cause));}
  }

  async function protect() {
    if (!payload) return;
    onResultAvailability?.(false);
    setError(""); setResult(null); setPhase("Starting protection");
    try {
      const form = new FormData(); form.append("cover", cover); form.append("content_file", payload);
      form.append("private_key", privateKey); form.append("key_password", keyPassword); form.append("depth", String(depth));
      const protectedFile = await job<VideoProtected>("/api/v2/jobs/protect", form, setPhase);
      setResult(protectedFile);
      onResultAvailability?.(true);
      const [stego, recovery] = await Promise.all([getFile(protectedFile.carrier), getFile(protectedFile.recovery)]);
      onHandoff({id: crypto.randomUUID(), protocol: "v2-video", stego, cover, sourceCover: source, conversion, passphrase: "", publicPem: publicKey,
        recovery, recoveryCode: protectedFile.recovery_code, serial: Date.now()});
    } catch (cause) {setError(errorText(cause));}
    finally {setPhase("");}
  }

  return <div className="form-column">
    <section className="panel"><h2>Lossless video carrier</h2><p>{cover.name} · {cover.size.toLocaleString()} bytes</p>
      {source && <p>Prepared from {source.name}. The video has no audio track.</p>}
      <p>This workflow uses Ed25519 and a separate recovery file/code. Keep the recovery code apart from the AVI.</p></section>
    <section className="panel"><h2>Payload and capacity</h2>
      <input type="file" aria-label="Video payload" onChange={(e) => setPayload(e.target.files?.[0] ?? null)} />
      <label>Bits per slot <input type="number" min="1" max="8" value={depth} onChange={(e) => setDepth(Number(e.target.value))} /></label>
      {payload && <p>{payload.name} · {payload.size.toLocaleString()} original bytes</p>}
      {payloadDigest && <p>Original payload SHA-256: <code className="full-hash">{payloadDigest}</code></p>}
      {capacity && <p>{capacity.total_bytes.toLocaleString()} encoded bytes; maximum payload {capacity.maximum_message_bytes.toLocaleString()} bytes.
        {capacity.fits_at_selected_start ? " Fits." : " Too large."}</p>}</section>
    <section className="panel"><h2>Ed25519 signing key</h2>
      <label>Key password<input type="password" value={keyPassword} onChange={(e) => setKeyPassword(e.target.value)} /></label>
      <button className="btn ghost" type="button" disabled={!keyPassword} onClick={() => void generateKeys()}>Generate video key pair</button>
      <label>Private key<textarea value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} /></label>
      <label>Public key<textarea value={publicKey} onChange={(e) => setPublicKey(e.target.value)} /></label></section>
    <button className="btn primary lg" type="button" disabled={!payload || !privateKey || !capacity?.fits_at_selected_start || Boolean(phase)} onClick={() => void protect()}>Embed in AVI</button>
    {phase && <p role="status">{phase}</p>}{error && <p role="alert">{error}</p>}
    {result && <section className="panel"><h2>Video protected</h2><HashEvidence evidence={result.payload_hash} />
      <div className="btn-row"><a className="btn primary" href={artifactUrl(result.carrier.id)} download={result.carrier.filename}>Download stego AVI</a>
        <a className="btn ghost" href={artifactUrl(result.recovery.id)} download={result.recovery.filename}>Download recovery file</a></div>
      <label>Recovery code (share separately)<input readOnly value={result.recovery_code} /></label>
    </section>}
  </div>;
}

export function VideoVerify({ handoff, onWorkingFile }: {handoff: Handoff; onWorkingFile?: (file: File | null) => void}) {
  const requestRevision = useRef(0);
  const [file, setFile] = useState(handoff.stego);
  const [recovery, setRecovery] = useState<File | null>(handoff.recovery ?? null);
  const [code, setCode] = useState(handoff.recoveryCode ?? "");
  const [publicKey, setPublicKey] = useState(handoff.publicPem);
  const [result, setResult] = useState<VideoVerified | null>(null);
  const [locationMode, setLocationMode] = useState<"stored" | "slot" | "frame">("stored");
  const [slot, setSlot] = useState("");
  const [frame, setFrame] = useState("0");
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [channel, setChannel] = useState("0");
  const [attempts, setAttempts] = useState<{location: string; verdict: string}[]>([]);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {requestRevision.current += 1; setFile(handoff.stego); setRecovery(handoff.recovery ?? null); setCode(handoff.recoveryCode ?? "");
    setPublicKey(handoff.publicPem); setResult(null);}, [handoff.id]);

  async function verify(mode = locationMode) {
    if (!recovery) return;
    const requestId = ++requestRevision.current;
    setError(""); setPhase("Verifying video");
    try {
      const form = new FormData(); form.append("stego", file); form.append("recovery", recovery);
      form.append("recovery_code", code); form.append("public_key", publicKey);
      if (mode === "slot") form.append("start_slot", slot);
      if (mode === "frame") {form.append("start_frame", frame); form.append("start_x", x); form.append("start_y", y); form.append("start_channel", channel);}
      await requestJson("/api/v2/session", {method: "POST"});
      const checked = await requestJson<VideoVerified>("/api/v4/video/verify", {method: "POST", body: form});
      if (requestId !== requestRevision.current) return;
      setResult(checked);
      setAttempts((before) => [...before, {location: mode === "stored" ? "authenticated stored location" : mode === "slot" ? `slot ${slot}` : `frame ${frame}, (${x}, ${y}), channel ${channel}`, verdict: checked.verdict}]);
    } catch (cause) {if (requestId === requestRevision.current) setError(errorText(cause));}
    finally {if (requestId === requestRevision.current) setPhase("");}
  }
  return <div className="form-column"><section className="panel"><h2>Verify lossless AVI</h2>
    <input type="file" accept=".avi,video/x-msvideo" aria-label="Protected AVI" onChange={(e) => {const next = e.target.files?.[0]; if (next) {requestRevision.current += 1; setFile(next); onWorkingFile?.(next); setResult(null); setAttempts([]);}}} />
    <p>{file.name}</p><label>Recovery file<input type="file" accept=".stegloc" onChange={(e) => setRecovery(e.target.files?.[0] ?? null)} /></label>
    <label>Recovery code<input value={code} onChange={(e) => setCode(e.target.value)} /></label>
    <label>Ed25519 public key<textarea value={publicKey} onChange={(e) => setPublicKey(e.target.value)} /></label>
    <label>Start location<select value={locationMode} onChange={(e) => setLocationMode(e.target.value as typeof locationMode)}>
      <option value="stored">Authenticated stored location</option><option value="slot">Exact slot</option><option value="frame">Frame coordinates</option></select></label>
    {locationMode === "slot" && <label>Slot<input type="number" min="0" value={slot} onChange={(e) => setSlot(e.target.value)} /></label>}
    {locationMode === "frame" && <div className="btn-row"><label>Frame<input type="number" min="0" value={frame} onChange={(e) => setFrame(e.target.value)} /></label>
      <label>X<input type="number" min="0" value={x} onChange={(e) => setX(e.target.value)} /></label>
      <label>Y<input type="number" min="0" value={y} onChange={(e) => setY(e.target.value)} /></label>
      <label>Channel<input type="number" min="0" max="2" value={channel} onChange={(e) => setChannel(e.target.value)} /></label></div>}
    <button type="button" className="btn primary" disabled={!recovery || !code || !publicKey || Boolean(phase)} onClick={() => void verify()}>Extract and verify</button>
    {phase && <p role="status">{phase}</p>}{error && <p role="alert">{error}</p>}</section>
    {result && <section className="panel"><h2>{result.verdict}</h2><HashEvidence evidence={result.payload_hash} />
      {result.content && <a className="btn primary" href={result.download_url ?? artifactUrl(result.content.id)} download={result.content.filename}>Download verified payload</a>}
      {result.verdict === "Wrong Start Location" && <div className="retry-panel"><p>Correct the location above and retry on the same AVI, or use its authenticated location.</p>
        <div className="btn-row"><button type="button" className="btn primary" onClick={() => void verify()}>Retry extraction</button>
          <button type="button" className="btn ghost" onClick={() => {setLocationMode("stored"); void verify("stored");}}>Use stored location and retry</button></div></div>}
      {attempts.length > 1 && <details><summary>Previous attempts ({attempts.length})</summary><ol>{attempts.map((item, i) => <li key={i}>{item.location}: {item.verdict}</li>)}</ol></details>}
      <details><summary>Verification stages</summary><pre>{JSON.stringify(result.stages, null, 2)}</pre></details>
    </section>}</div>;
}
