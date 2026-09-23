import { KeysForm } from "./v2/KeysForm";
import { ProtectedSummary, VerificationSummary } from "./v2/Results";
import { useEffect, useState } from "react";
import { DropZone, ErrorNote, MediaPreview, Panel, Spinner } from "../components";
import { downloadText, errorText, formatBytes } from "../util";

import { artifactUrl, requestJson as json, runV2Job as job } from "../api/jobs";
import { cancelJob, closeSession, fetchArtifact, generatedFiles, type Stored, type ProtectResult, type VerifyResult } from "../api/v2";

export function V2Page() {
  const [session, setSession] = useState(false);
  const [privatePem, setPrivatePem] = useState("");
  const [publicPem, setPublicPem] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [payload, setPayload] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [depth, setDepth] = useState(3);
  const [start, setStart] = useState("");
  const [videoFrame, setVideoFrame] = useState("");
  const [videoX, setVideoX] = useState("");
  const [videoY, setVideoY] = useState("");
  const [videoChannel, setVideoChannel] = useState(0);
  const [stego, setStego] = useState<File | null>(null);
  const [recovery, setRecovery] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [protectedResult, setProtectedResult] = useState<ProtectResult | null>(null);
  const [capacity, setCapacity] = useState<{ content_bytes: number; overhead_bytes: number; total_bytes: number;
    available_from_start: number; fits_at_selected_start: boolean; maximum_message_bytes: number;
    raw_embedding_bytes: number } | null>(null);
  const [verifiedResult, setVerifiedResult] = useState<VerifyResult | null>(null);
  const [preview, setPreview] = useState<{ url: string; text?: string } | null>(null);
  const [activeJob, setActiveJob] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const content = verifiedResult?.content;
    if (!content || content.size > 10 * 1024 * 1024) { setPreview(null); return; }
    let active = true;
    let objectUrl = "";
    void fetchArtifact(content.id).then(async (response) => {
      if (!response.ok) return;
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      if (active) setPreview({ url: objectUrl, text: content.media_type?.startsWith("text/") ? await blob.text() : undefined });
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (active) setPreview(null); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [verifiedResult?.content?.id]);

  async function ensureSession() {
    if (session) return;
    await json<{ status: string }>("/api/v2/session", { method: "POST" });
    setSession(true);
  }

  async function generate() {
    setError("");
    try {
      const form = new FormData(); form.append("password", keyPassword);
      const keys = await json<{ private_key: string; public_key: string; fingerprint: string }>(
        "/api/v2/keys/generate", { method: "POST", body: form });
      setPrivatePem(keys.private_key); setPublicPem(keys.public_key); setFingerprint(keys.fingerprint);
    } catch (cause) { setError(errorText(cause)); }
  }

  async function inspectPublic() {
    setError("");
    try {
      const form = new FormData(); form.append("public_key", publicPem);
      const info = await json<{ fingerprint: string }>("/api/v2/keys/inspect", { method: "POST", body: form });
      setFingerprint(info.fingerprint);
    } catch (cause) { setError(errorText(cause)); }
  }

  async function protect() {
    if (!cover || (!payload && !message) || !privatePem) return;
    setError(""); setProtectedResult(null); setStatus("Preparing sender job");
    try {
      await ensureSession();
      const form = new FormData();
      form.append("cover", cover); form.append("private_key", privatePem); form.append("key_password", keyPassword);
      form.append("depth", String(depth));
      if (cover.name.toLowerCase().endsWith(".avi") && videoFrame && videoX && videoY) {
        form.append("start_frame", videoFrame); form.append("start_x", videoX); form.append("start_y", videoY);
        form.append("start_channel", String(videoChannel));
      } else if (start) form.append("start_slot", start);
      if (payload) form.append("content_file", payload); else form.append("content_text", message);
      const result = await job<ProtectResult>("/api/v2/jobs/protect", form, (state, id) => { setStatus(state); setActiveJob(id); });
      setProtectedResult(result); setCode(result.recovery_code);
    } catch (cause) { setError(errorText(cause)); }
    finally { setActiveJob(""); }
  }

  async function checkCapacity() {
    if (!cover) return;
    setError("");
    try {
      const form = new FormData();
      form.append("cover", cover);
      form.append("content_length", String(payload?.size ?? new TextEncoder().encode(message).length));
      form.append("content_name", payload?.name ?? "message.txt");
      form.append("content_type", payload?.type || (payload ? "application/octet-stream" : "text/plain; charset=utf-8"));
      form.append("depth", String(depth));
      if (cover.name.toLowerCase().endsWith(".avi") && videoFrame && videoX && videoY) {
        form.append("start_frame", videoFrame); form.append("start_x", videoX); form.append("start_y", videoY);
        form.append("start_channel", String(videoChannel));
      } else if (start) form.append("start_slot", start);
      setCapacity(await json("/api/v2/estimate", { method: "POST", body: form }));
    } catch (cause) { setError(errorText(cause)); }
  }

  async function verify() {
    if (!stego || !recovery || !code || !publicPem) return;
    setError(""); setVerifiedResult(null); setStatus("Preparing recipient job");
    try {
      await ensureSession();
      const form = new FormData();
      form.append("stego", stego); form.append("recovery", recovery);
      form.append("recovery_code", code); form.append("public_key", publicPem);
      const result = await job<VerifyResult>("/api/v2/jobs/verify", form, (state, id) => { setStatus(state); setActiveJob(id); });
      setVerifiedResult(result);
    } catch (cause) { setError(errorText(cause)); }
    finally { setActiveJob(""); }
  }

  async function useGenerated() {
    if (!protectedResult) return;
    try {
      const [carrier, sidecar] = await generatedFiles(protectedResult);
      setStego(carrier);
      setRecovery(sidecar);
      setVerifiedResult(null);
    } catch (cause) { setError(errorText(cause)); }
  }

  async function reset() {
    if (session) await closeSession();
    setSession(false); setProtectedResult(null); setVerifiedResult(null); setCapacity(null); setCode("");
    setStego(null); setRecovery(null); setActiveJob(""); setStatus(""); setError("");
    setPrivatePem(""); setPublicPem(""); setKeyPassword(""); setFingerprint("");
    setCover(null); setPayload(null); setMessage(""); setStart("");
    setVideoFrame(""); setVideoX(""); setVideoY(""); setVideoChannel(0);
  }

  const busy = Boolean(activeJob);
  return <div className="form-column">
    <KeysForm password={keyPassword} onPassword={setKeyPassword}
      privatePem={privatePem} onPrivatePem={setPrivatePem} publicPem={publicPem}
      onPublicPem={(pem) => { setPublicPem(pem); setFingerprint(""); setVerifiedResult(null); }}
      fingerprint={fingerprint} onGenerate={() => void generate()} onInspect={() => void inspectPublic()} />

    <Panel title="Protect a file" subtitle="PNG, 24-bit BMP, integer PCM WAV, or one-stream uncompressed 24-bit AVI. A video file may be hidden inside a larger AVI.">
      <div className="columns">
        <DropZone label="Cover file" id="v2-cover" title="Drop or choose cover" hint="PNG, BMP, WAV or AVI"
          accept=".png,.bmp,.wav,.avi" file={cover} onFile={(file) => { setCover(file); setCapacity(null); }} />
        <DropZone label="Content file" id="v2-payload" title="Drop or choose content" hint="Any file that fits"
          file={payload} onFile={(file) => { setPayload(file); setCapacity(null); }} />
        <div className="field"><label htmlFor="v2-message">Or a text message</label>
          <textarea id="v2-message" value={message} onChange={(event) => { setMessage(event.target.value); setCapacity(null); }} rows={3} /></div>
        <div className="field"><label htmlFor="v2-depth">LSB depth (1–8)</label>
          <input id="v2-depth" type="number" min="1" max="8" value={depth} onChange={(event) => { setDepth(Number(event.target.value)); setCapacity(null); }} /></div>
        <div className="field"><label htmlFor="v2-start">Start slot (blank chooses a keyed nonzero location)</label>
          <input id="v2-start" type="number" min="0" value={start} onChange={(event) => { setStart(event.target.value); setCapacity(null); }} /></div>
        {cover?.name.toLowerCase().endsWith(".avi") && <>
          <div className="field"><label htmlFor="v2-frame">AVI start frame (optional)</label>
            <input id="v2-frame" type="number" min="0" value={videoFrame} onChange={(event) => { setVideoFrame(event.target.value); setCapacity(null); }} /></div>
          <div className="field"><label htmlFor="v2-x">AVI pixel X</label>
            <input id="v2-x" type="number" min="0" value={videoX} onChange={(event) => { setVideoX(event.target.value); setCapacity(null); }} /></div>
          <div className="field"><label htmlFor="v2-y">AVI pixel Y</label>
            <input id="v2-y" type="number" min="0" value={videoY} onChange={(event) => { setVideoY(event.target.value); setCapacity(null); }} /></div>
          <div className="field"><label htmlFor="v2-channel">AVI color channel</label>
            <select id="v2-channel" value={videoChannel} onChange={(event) => { setVideoChannel(Number(event.target.value)); setCapacity(null); }}>
              <option value={0}>Blue</option><option value={1}>Green</option><option value={2}>Red</option>
            </select></div>
        </>}
      </div>
      <div className="btn-row"><button type="button" className="btn ghost" disabled={!cover} onClick={() => void checkCapacity()}>Check capacity</button>
        <button type="button" className="btn primary" disabled={busy || !cover || (!payload && !message) || !privatePem || capacity?.fits_at_selected_start === false}
        onClick={() => void protect()}>Protect and export</button></div>
      {capacity && <p className="field-hint">Content {formatBytes(capacity.content_bytes)} + security overhead {formatBytes(capacity.overhead_bytes)}
        = {formatBytes(capacity.total_bytes)} needed; {formatBytes(capacity.available_from_start)} available from the selected start.
        {capacity.fits_at_selected_start ? " Fits." : " Does not fit."}
        {` Maximum message: ${formatBytes(capacity.maximum_message_bytes)} after security overhead (raw LSB space: ${formatBytes(capacity.raw_embedding_bytes)}).`}
        {" BPCS capacity is a separate theoretical estimate."}</p>}
      {protectedResult && <ProtectedSummary result={protectedResult} onUse={() => void useGenerated()} />}
    </Panel>

    <Panel title="Extract and verify" subtitle="Use the received carrier, its .stegloc file, the separately supplied code, and the sender's trusted public key.">
      <div className="columns">
        <DropZone label="Received carrier" id="v2-stego" title="Drop or choose received file" hint="Protected PNG, BMP, WAV or AVI"
          accept=".png,.bmp,.wav,.avi" file={stego} onFile={(file) => { setStego(file); setVerifiedResult(null); }} />
        <DropZone label="Recovery file" id="v2-recovery" title="Drop or choose recovery file" hint=".stegloc file"
          accept=".stegloc" file={recovery} onFile={(file) => { setRecovery(file); setVerifiedResult(null); }} />
        <div className="field"><label htmlFor="v2-code">Recovery code</label>
          <input id="v2-code" value={code} onChange={(event) => { setCode(event.target.value); setVerifiedResult(null); }} /></div>
      </div>
      <div className="btn-row"><button type="button" className="btn primary" disabled={busy || !stego || !recovery || !code || !publicPem}
        onClick={() => void verify()}>Extract and verify</button></div>
      {verifiedResult && <VerificationSummary result={verifiedResult} preview={preview} />}
    </Panel>
    <div className="btn-row">
      {busy && <><span role="status"><Spinner /> {status}</span>
        <button type="button" className="btn ghost" onClick={() => void cancelJob(activeJob)}>Cancel job</button></>}
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void reset()}>Reset v2 session</button>
    </div>
    <ErrorNote text={error} />
  </div>;
}
