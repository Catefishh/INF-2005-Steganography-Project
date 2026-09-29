import { useEffect, useRef, useState } from "react";
import { artifactUrl, pollJob, requestJson, type Job } from "../api/jobs";
import { HashEvidence, type HashEvidenceData } from "../ui/hashEvidence";
import { ActionBar, Disclosure, DropZone, ErrorNote, Icon, InputStrip, KeyField, LsbDepthPicker, Meter, Outcome, Panel } from "../components";
import { verdictReading } from "../verdict";
import type { VerdictName } from "../api";
import type { Handoff, Page } from "../util";
import { downloadText, errorText, formatBytes } from "../util";

type Stored = {id: string; filename: string; size: number; media_type?: string};
type VideoProtected = {carrier: Stored; recovery: Stored; recovery_code: string; payload_hash: HashEvidenceData; record: {content: {sha256: string}}};
type VideoVerified = {verdict: VerdictName; stages: Record<string, {status: string; evidence: string; reason: string}>;
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

export function VideoEmbed({ cover, source, conversion, onHandoff, goTo, showResult, onShowResult, onResultAvailability,
  onCoverFile, onChooseAvi }: {cover: File; source: File | null; conversion?: Handoff["conversion"];
  onHandoff: (value: Handoff) => void; goTo: (page: Page) => void; showResult: boolean; onShowResult: (show: boolean) => void;
  onResultAvailability?: (available: boolean) => void; onCoverFile?: (file: File | null) => void;
  onChooseAvi?: () => void}) {
  const originalFormat = !/\.avi$/i.test(cover.name);
  const videoType = originalFormat ? cover.name.split(".").pop()?.toUpperCase() : "AVI";
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
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const requestRevision = useRef(0);

  useEffect(() => { if (result && showResult) resultHeading.current?.focus(); }, [result, showResult]);
  useEffect(() => { if (showResult && !result) onShowResult(false); }, [showResult, result, onShowResult]);
  useEffect(() => {
    if (result) {setResult(null); onResultAvailability?.(false);}
    if (phase) setPhase("");
    return () => {requestRevision.current += 1;};
  }, [cover, payload, depth, privateKey, publicKey, keyPassword]);

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
    const revision = ++requestRevision.current;
    onResultAvailability?.(false);
    setError(""); setResult(null); setPhase("Starting protection");
    try {
      const form = new FormData(); form.append("cover", cover); form.append("content_file", payload);
      form.append("private_key", privateKey); form.append("key_password", keyPassword); form.append("depth", String(depth));
      const protectedFile = await job<VideoProtected>("/api/v2/jobs/protect", form,
        (next) => {if (revision === requestRevision.current) setPhase(next);});
      if (revision !== requestRevision.current) return;
      const [stego, recovery] = await Promise.all([getFile(protectedFile.carrier), getFile(protectedFile.recovery)]);
      if (revision !== requestRevision.current) return;
      setResult(protectedFile);
      onResultAvailability?.(true);
      onShowResult(true);
      onHandoff({id: crypto.randomUUID(), protocol: "v2-video", stego, cover, sourceCover: source, conversion, passphrase: "", publicPem: publicKey,
        recovery, recoveryCode: protectedFile.recovery_code, serial: Date.now()});
    } catch (cause) {if (revision === requestRevision.current) setError(errorText(cause));}
    finally {if (revision === requestRevision.current) setPhase("");}
  }

  if (result && showResult) return <div className="result-column">
    <Outcome tone="good" icon="shield" label="Done" title="Video protected" headingRef={resultHeading}
      summary={<>Your file is hidden in a lossless {videoType} and signed with the video key. Send <b>{result.carrier.filename}</b> to the receiver.</>}
      actions={<a className="btn primary lg" href={artifactUrl(result.carrier.id)} download={result.carrier.filename}>
        <Icon name="download" /> Download protected {videoType}
      </a>} />
    <InputStrip items={[
      {label: "Cover", value: source?.name ?? cover.name, icon: "file"},
      {label: "Hidden", value: payload?.name ?? "file"},
      {label: "Depth", value: `${depth} bits per slot`},
    ]} actions={<button type="button" className="btn ghost sm" onClick={() => onShowResult(false)}>
      <Icon name="pen" size={14} /> Edit and run again
    </button>} />
    <HashEvidence evidence={result.payload_hash} />
    <Panel title="Save the recovery material" subtitle="The receiver needs the recovery file, code, and video public key to verify and extract.">
      <div className="note note-warn"><Icon name="alert" /><span>Keep the recovery code separate from the protected video and recovery file. Save the encrypted private key for future signing; never send it to the receiver.</span></div>
      <div className="btn-row">
        <a className="btn ghost" href={artifactUrl(result.recovery.id)} download={result.recovery.filename}><Icon name="download" /> Download recovery file</a>
        <button type="button" className="btn ghost" onClick={() => downloadText("stegloc-recovery-code.txt", result.recovery_code)}><Icon name="download" /> Download recovery code</button>
        {publicKey && <button type="button" className="btn ghost" onClick={() => downloadText("video_public_key.pem", publicKey)}>Save video public key</button>}
        {privateKey && <button type="button" className="btn ghost" onClick={() => downloadText("video_private_key.pem", privateKey)}>Save video private key</button>}
      </div>
      <div className="field"><label htmlFor="video-embed-code">Recovery code (share separately)</label>
        <input id="video-embed-code" type="text" readOnly value={result.recovery_code} /></div>
    </Panel>
    <Panel title="Or carry on with this file" className="next-steps"><div className="btn-row">
      <button type="button" className="btn ghost" onClick={() => goTo("verify")}><Icon name="eye" /> Verify it as the receiver would</button>
      <button type="button" className="btn ghost" onClick={() => goTo("analyse")}><Icon name="layers" /> Inspect it for traces</button>
      <button type="button" className="btn ghost" onClick={() => goTo("attacks")}><Icon name="zap" /> Run the tamper tests</button>
    </div></Panel>
    <ErrorNote text={error} />
  </div>;

  const missing = [!payload && "a file to hide", !privateKey.trim() && "an Ed25519 private key", !publicKey.trim() && "the matching Ed25519 public key",
    payload && !capacity && "a capacity estimate", capacity && !capacity.fits_at_selected_start && "a larger video cover"]
    .filter(Boolean) as string[];
  return <div className="form-column">
    <Panel step="1" title={originalFormat ? "Original video carrier" : "Lossless AVI carrier"}
      subtitle={originalFormat ? "Stegloc writes into decoded frames, then saves them with lossless RGB video encoding."
        : "The uncompressed AVI carries the hidden bits in its video frames."}
      aside={<span className="chip good">{videoType} · lossless frames</span>}>
      {onCoverFile && <DropZone label="Video file" title="Drop a video file" hint="or click to choose another video"
        accept=".mp4,.mov,.avi,.mkv,.webm,.flv,.wmv,.3gp,.m4v,.mpg,.mpeg,.ts,video/*" icon="file" file={source ?? cover} onFile={onCoverFile} />}
      <div className="facts"><span><b>{cover.name}</b>{formatBytes(cover.size)} {originalFormat ? "original-format cover" : "AVI cover"}</span>
        {source && source !== cover && <span><b>{source.name}</b>source video · audio kept when present</span>}</div>
      <div className="btn-row">
        {originalFormat && onChooseAvi && /video|audio|frame|codec|container|media|decode/i.test(error) &&
          <button type="button" className="btn ghost" onClick={onChooseAvi}>Prepare AVI for this video</button>}
        {!originalFormat && source && source !== cover && onChooseAvi &&
          <button type="button" className="btn quiet" onClick={onChooseAvi}>Clear prepared AVI</button>}
      </div>
      <p className="muted small">Audio is kept when present. Lossless RGB {videoType} playback depends on the player's codec support. Verification checks decoded video and audio, and uses an Ed25519 key with a separate recovery file and code.</p>
    </Panel>
    <Panel step="2" title="Choose what to hide" subtitle="The file is encrypted, signed, and hidden in the video frames.">
      <DropZone label="File to hide" title="Drop any file to hide" hint="or click to choose a file" icon="file"
        file={payload} onFile={setPayload} tone={capacity && !capacity.fits_at_selected_start ? "bad" : ""} />
      {payloadDigest && <div className="hash-evidence"><div className="hash-heading"><h2>Payload SHA-256 before embedding</h2></div>
        <p>{payload?.name} · {payload && formatBytes(payload.size)} original bytes</p><code>{payloadDigest}</code></div>}
      <LsbDepthPicker value={depth} onChange={setDepth} capacity={capacity?.maximum_message_bytes ?? null}
        riskMessage="More bits fit more in, but past 3 changes to the video frames can become visible." />
      <Meter used={payload ? payload.size : null} total={capacity?.maximum_message_bytes ?? null} label={`Room in this ${videoType}`}
        reading={capacity && !capacity.fits_at_selected_start ? "Too large" : capacity ? "Fits" : undefined} />
      {capacity && <p className="muted small">Encrypted package: {formatBytes(capacity.total_bytes)} including signing and recovery overhead.</p>}
      {capacity && !capacity.fits_at_selected_start && <div className="note note-error" role="alert"><Icon name="alert" /><span>
        <b>This file is too large for this video.</b> Choose a smaller file or increase the bits per slot.
      </span></div>}
    </Panel>
    <Panel step="3" title="Lock and sign it" subtitle="Generate an Ed25519 pair for video, or paste one you already have.">
      <div className="field"><label htmlFor="video-key-password">Key password</label>
        <input id="video-key-password" type="password" value={keyPassword} onChange={(e) => setKeyPassword(e.target.value)} />
        <small className="field-hint">Encrypts the private key you generate here. Keep it for future signing.</small>
      </div>
      <button className="btn ghost self-start" type="button" disabled={!keyPassword} onClick={() => void generateKeys()}>Generate video key pair</button>
      <KeyField label="Private key" value={privateKey} onChange={setPrivateKey}
        placeholder="-----BEGIN ENCRYPTED PRIVATE KEY----- (load or paste your video private key)" />
      <KeyField label="Public key" value={publicKey} onChange={setPublicKey}
        placeholder="-----BEGIN PUBLIC KEY----- (load or paste your video public key)" />
      <div className="btn-row">
        <button type="button" className="btn ghost sm" disabled={!privateKey} onClick={() => downloadText("video_private_key.pem", privateKey)}>Save private key</button>
        <button type="button" className="btn ghost sm" disabled={!publicKey} onClick={() => downloadText("video_public_key.pem", publicKey)}>Save public key</button>
      </div>
    </Panel>
    <ActionBar missing={missing} heading={missing.length ? undefined : `Ready to embed in ${videoType}`}
      detail={missing.length ? undefined : "The receiver will need the separate recovery file, code, and public key."}>
      {(reasonId) => <button className="btn primary lg" type="button" disabled={missing.length > 0 || Boolean(phase)}
        aria-describedby={reasonId} onClick={() => void protect()}>{phase ? phase : `Embed in ${videoType}`}</button>}
    </ActionBar>
    <ErrorNote text={error} />
  </div>;
}

export function VideoVerify({ handoff, onWorkingFile, showResult, onShowResult }: {handoff: Handoff; onWorkingFile?: (file: File | null) => void;
  showResult: boolean; onShowResult: (show: boolean) => void}) {
  const requestRevision = useRef(0);
  const codeFileRevision = useRef(0);
  const [file, setFile] = useState<File | null>(handoff.stego);
  const [recovery, setRecovery] = useState<File | null>(handoff.recovery ?? null);
  const [code, setCode] = useState(handoff.recoveryCode ?? "");
  const [codeFile, setCodeFile] = useState<File | null>(null);
  const [publicKey, setPublicKey] = useState(handoff.protocol === "v2-video" ? handoff.publicPem : "");
  const [publicKeyError, setPublicKeyError] = useState("");
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
  const outcomeRef = useRef<HTMLHeadingElement>(null);
  function invalidate(keepAttempts = false) {
    requestRevision.current += 1;
    setResult(null); setPhase(""); setError("");
    if (!keepAttempts) setAttempts([]);
  }
  useEffect(() => {requestRevision.current += 1; codeFileRevision.current += 1;
    setFile(handoff.stego); setRecovery(handoff.recovery ?? null); setCode(handoff.recoveryCode ?? ""); setCodeFile(null);
    setPublicKey(handoff.protocol === "v2-video" ? handoff.publicPem : ""); setPublicKeyError("");
    setResult(null); setPhase(""); setError(""); setAttempts([]);}, [handoff.id]);
  useEffect(() => {if (showResult && !result) onShowResult(false);}, [showResult, result, onShowResult]);
  useEffect(() => {if (showResult && result) outcomeRef.current?.focus();}, [showResult, result]);

  function loadCodeFile(next: File | null) {
    const revision = ++codeFileRevision.current;
    invalidate(); setCodeFile(next); setCode("");
    if (!next) return;
    if (next.size > 4096) {setError("Recovery code file is too large."); return;}
    void next.text().then((text) => {
      if (revision !== codeFileRevision.current) return;
      const value = text.trim();
      if (!value || value.length > 100) {setError("Recovery code file must contain one code of up to 100 characters."); return;}
      setCode(value);
    }).catch((cause) => {if (revision === codeFileRevision.current) setError(errorText(cause));});
  }

  function choosePublicKey(pem: string) {
    invalidate();
    if (pem.includes("PRIVATE KEY")) {setPublicKey(""); setPublicKeyError("This is a private key. Load the sender's Ed25519 public key instead."); return;}
    setPublicKeyError(""); setPublicKey(pem);
  }

  async function verify(mode = locationMode) {
    if (!file || !recovery) return;
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
      if (!showResult) onShowResult(true);
    } catch (cause) {if (requestId === requestRevision.current) setError(errorText(cause));}
    finally {if (requestId === requestRevision.current) setPhase("");}
  }
  if (result && showResult) {
    const reading = verdictReading(result.verdict);
    const stages = Object.entries(result.stages);
    return <div className="result-column">
      <Outcome tone={reading.tone} icon={reading.icon} label={`Verdict · ${result.verdict}`} title={reading.headline}
        headingRef={outcomeRef} summary={result.verdict === "Authentic"
          ? "The video's Ed25519 signature matches the sender's public key and its integrity checks passed."
          : result.verdict === "Wrong Start Location"
            ? "The place you chose does not contain the authenticated payload. Try the location stored in the file."
            : "The video did not pass verification with these recovery materials. Review the failed check below."} />
      <HashEvidence evidence={result.payload_hash} />
      {result.content && <Panel title="What was hidden inside" aside={<span className="chip good">{formatBytes(result.content.size)}</span>}>
        <p>{result.content.filename}</p>
        <div className="btn-row"><a className="btn primary" href={result.download_url ?? artifactUrl(result.content.id)} download={result.content.filename}>
          <Icon name="download" /> Download verified payload
        </a></div>
      </Panel>}
      {result.verdict === "Wrong Start Location" && <Panel title="Retry on this video" className="recovery">
        <p>Use the authenticated start location stored in the recovery material, or edit the location you entered.</p>
        <div className="btn-row"><button type="button" className="btn primary" disabled={Boolean(phase)} onClick={() => {setLocationMode("stored"); void verify("stored");}}>
          Use stored location and retry
        </button><button type="button" className="btn ghost" onClick={() => onShowResult(false)}>Change the location</button></div>
      </Panel>}
      <ErrorNote text={error} />
      <Disclosure title="What was checked" value={`${stages.filter(([, stage]) => stage.status === "passed").length} of ${stages.length} passed`}
        defaultOpen={result.verdict !== "Authentic"}>
        <div className="table-wrap"><table className="kv"><tbody>{stages.map(([name, stage]) => <tr key={name}>
          <th>{name.replaceAll("_", " ")}</th><td><span className={`chip ${stage.status === "passed" ? "good" : stage.status === "failed" ? "bad" : "flat"}`}>{stage.status}</span>
            {" "}{stage.reason || stage.evidence}</td>
        </tr>)}</tbody></table></div>
      </Disclosure>
      {attempts.length > 1 && <Disclosure title="Previous attempts" value={`${attempts.length} checks`}>
        <ol>{attempts.map((item, i) => <li key={i}>{item.location}: {item.verdict}</li>)}</ol>
      </Disclosure>}
      <InputStrip items={[{label: "Checked", value: file?.name ?? "video", icon: "eye"},
        {label: "Recovery", value: recovery?.name ?? "file"},
        {label: "Start", value: locationMode === "stored" ? "authenticated stored location" : "chosen by you"}]}
        actions={<button type="button" className="btn ghost sm" onClick={() => onShowResult(false)}>
          <Icon name="pen" size={14} /> Change and check again
        </button>} />
    </div>;
  }

  const missing = [!file && "a protected video", !recovery && "a recovery file", !code.trim() && "a recovery code",
    !publicKey.trim() && "the sender's Ed25519 public key"].filter(Boolean) as string[];
  return <div className="form-column">
    <Panel step="1" title="The file you received" subtitle="Choose the protected video in its saved format.">
      {handoff.origin !== "manual" && <div className="note note-info"><Icon name="send" /><span>Loaded from Embed &amp; Sign.
        <span className="note-actions"><button type="button" className="btn ghost sm" onClick={() => document.querySelector<HTMLInputElement>('#video-verify-file-slot input[type="file"]')?.click()}>Use a different file</button></span>
      </span></div>}
      <DropZone id="video-verify-file-slot" label="Protected video" title="Drop a protected video" hint="or click to browse"
        accept=".mp4,.mov,.avi,.mkv,.webm,.flv,.wmv,.3gp,.m4v,video/*" icon="eye" file={file} onFile={(next) => {invalidate(); setFile(next); onWorkingFile?.(next);}} />
      {file && <div className="facts"><span><b>{file.name}</b>{formatBytes(file.size)} · video to check</span></div>}
    </Panel>
    <Panel step="2" title="What you need to open it" subtitle="The recovery file and code locate the payload; the sender's Ed25519 public key checks its signature.">
      {handoff.protocol !== "v2-video" && <div className="note note-info"><Icon name="key" /><span>Protected videos use an Ed25519 public key from the sender. The RSA key pair on the Keys page does not apply here.</span></div>}
      <DropZone label="Recovery file" title="Drop the recovery file" hint="or choose the .stegloc file"
        accept=".stegloc" icon="key" file={recovery} onFile={(next) => {invalidate(); setRecovery(next);}} />
      <div className="recovery-code-input">
        <div className="field"><label htmlFor="video-verify-code">Recovery code</label>
          <input id="video-verify-code" type="text" value={code} placeholder="Paste the code shared separately"
            onChange={(event) => {codeFileRevision.current += 1; invalidate(); setCodeFile(null); setCode(event.target.value);}} />
          <small className="field-hint">The code is separate from the video and recovery file.</small>
        </div>
        <DropZone label="Recovery code file" title="Drop stegloc-recovery-code.txt"
          hint="or click to upload the downloaded code" accept=".txt,text/plain" icon="file" file={codeFile} onFile={loadCodeFile} />
      </div>
      <KeyField label="Sender's Ed25519 public key" value={publicKey} onChange={choosePublicKey}
        placeholder="-----BEGIN PUBLIC KEY----- (load video_public_key.pem or paste it)" />
      <ErrorNote text={publicKeyError} />
      <Disclosure title="Look in a specific place instead" value={locationMode === "stored" ? "off · use authenticated location" : "on · manual location"}
        tone={locationMode === "stored" ? "" : "warn"}>
        {locationMode !== "stored" && <div className="note note-warn"><Icon name="alert" /><span>A manual location can return “Wrong Start Location” even when the video is genuine. Use the stored location for a normal check.</span></div>}
        <div className="field"><label htmlFor="video-start-mode">Start location</label><select id="video-start-mode" value={locationMode}
          onChange={(event) => {invalidate(true); setLocationMode(event.target.value as typeof locationMode);}}>
          <option value="stored">Authenticated stored location</option><option value="slot">Exact slot</option><option value="frame">Frame coordinates</option>
        </select></div>
        {locationMode === "slot" && <div className="field"><label htmlFor="video-slot">Slot</label><input id="video-slot" type="number" min="0" value={slot} onChange={(event) => {invalidate(true); setSlot(event.target.value);}} /></div>}
        {locationMode === "frame" && <div className="inline-fields">
          <label>Frame<input type="number" min="0" value={frame} onChange={(event) => {invalidate(true); setFrame(event.target.value);}} /></label>
          <label>X<input type="number" min="0" value={x} onChange={(event) => {invalidate(true); setX(event.target.value);}} /></label>
          <label>Y<input type="number" min="0" value={y} onChange={(event) => {invalidate(true); setY(event.target.value);}} /></label>
          <label>Channel<input type="number" min="0" max="2" value={channel} onChange={(event) => {invalidate(true); setChannel(event.target.value);}} /></label>
        </div>}
      </Disclosure>
      <ErrorNote text={error} />
    </Panel>
    <ActionBar missing={missing} heading={missing.length ? undefined : "Ready to check the video"}
      detail={missing.length ? undefined : "The app will verify the signature and integrity before releasing the hidden file."}>
      {(reasonId) => <button type="button" className="btn primary lg" disabled={missing.length > 0 || Boolean(phase)}
        aria-describedby={reasonId} aria-busy={Boolean(phase)} onClick={() => void verify()}>
        <Icon name="eye" /> {phase || "Extract and verify"}
      </button>}
    </ActionBar>
  </div>;
}
