import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, fetchAsFile, fileUrl, type CoverInfo, type HideReport, type HideResponse, type StoredFile } from "../api";
import {
  ActionBar, ByteDiagram, CompareSlider, Disclosure, DropZone, ErrorNote, HideTimeline, Icon, InputStrip, KeyField, Reveal,
  LectureTable, MediaPreview, Meter, Metric, Outcome, Panel, PassphraseField, Spinner, Waveform,
} from "../components";
import { differenceLabel, differenceReading, qualityReading, roomReading, touchedReading } from "../readings";
import { embedMissing } from "../requirements";
import { LONG_MESSAGE, SHORT_MESSAGE } from "../samples";
import { VideoEmbed } from "./VideoWorkflow";
import { errorText, formatBytes, shortHash, useDebounced, useObjectUrl, type Handoff, type Page, type Vault } from "../util";

const COVER_ACCEPT = "image/*,audio/*,video/*,.png,.bmp,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.wav,.mp3,.mp4,.mov,.avi";

const COVER_SLOT_ID = "embed-cover-slot";
const PAYLOAD_SLOT_ID = "embed-payload-slot";

/** "1 bit per colour value" reads wrong for audio, and "per sample" reads wrong for pictures. */
function depthPhrase(kind: CoverInfo["kind"] | undefined, nLsb: number): string {
  const unit = kind === "audio" ? "sample" : kind === "image" ? "colour value" : "value";
  return `${nLsb} bit${nLsb === 1 ? "" : "s"} per ${unit}`;
}

export function HidePage({ vault, onHandoff, goTo, showResult, onShowResult }: {
  vault: Vault;
  onHandoff: (handoff: Handoff) => void;
  goTo: (page: Page) => void;
  /** True when the route asks for /embed/result. */
  showResult: boolean;
  /** Moves the route between the form and the result. */
  onShowResult: (show: boolean) => void;
}) {
  const [cover, setCover] = useState<File | null>(null);
  const [sourceCover, setSourceCover] = useState<File | null>(null);
  const [conversion, setConversion] = useState<Handoff["conversion"]>();
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [segmentStart, setSegmentStart] = useState("0");
  const [segmentDuration, setSegmentDuration] = useState("3");
  const [segmentFps, setSegmentFps] = useState("24");
  const [videoMaxWidth, setVideoMaxWidth] = useState("640");
  const [videoMaxHeight, setVideoMaxHeight] = useState("360");
  const [sourceDetails, setSourceDetails] = useState<{kind: string; duration: number; streams: {type: string; codec: string; width?: number; height?: number}[]} | null>(null);
  const [info, setInfo] = useState<CoverInfo | null>(null);
  const [coverError, setCoverError] = useState("");
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [payloadFile, setPayloadFile] = useState<File | null>(null);
  const [payloadDigest, setPayloadDigest] = useState("");
  const [nLsb, setNLsb] = useState(1);
  const [startMode, setStartMode] = useState<"auto" | "manual">("auto");
  const [startX, setStartX] = useState("16");
  const [startY, setStartY] = useState("16");
  const [startSeconds, setStartSeconds] = useState("1");
  const [passphrase, setPassphrase] = useState("");
  const [privatePem, setPrivatePem] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [keyBits, setKeyBits] = useState(2048);
  const [team, setTeam] = useState("");
  const [packageBytes, setPackageBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<HideResponse | null>(null);
  const [usedCover, setUsedCover] = useState<File | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);

  const messageId = `${useId()}message`;
  const labelId = `${useId()}team`;
  const keyPasswordId = `${useId()}keypw`;
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const submitted = useRef(0);
  const depthRef = useRef<HTMLDivElement>(null);

  const coverUrl = useObjectUrl(cover);
  const usedCoverUrl = useObjectUrl(usedCover);

  useEffect(() => {
    if (vault.privatePem) setPrivatePem(vault.privatePem);
  }, [vault.privatePem]);

  useEffect(() => {
    setInfo(null);
    setCoverError("");
    if (!cover) return;
    if (/\.avi$/i.test(cover.name)) return;
    let live = true;
    api.inspect(cover)
      .then((details) => live && setInfo(details))
      .catch((e: unknown) => {
        if (!live) return;
        void api.probeMedia(cover).then((details) => {
          if (live) {setCover(null); setSourceDetails(details);}
        }).catch(() => {if (live) setCoverError(errorText(e));});
      });
    return () => {
      live = false;
    };
  }, [cover]);

  async function selectCover(file: File | null) {
    const revision = ++submitted.current;
    setSourceCover(file);
    setConversion(undefined);
    setCover(null);
    setInfo(null);
    setResult(null);
    setSourceDetails(null);
    setCoverError("");
    if (!file) return;
    let compatibleHeader = false;
    let detectedSuffix: ".avi" | ".wav" | null = null;
    try {
      const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const ascii = String.fromCharCode(...header);
      compatibleHeader = ascii.startsWith("BM") || ascii.startsWith("GIF8") || ascii.startsWith("\xff\xd8") ||
        ascii.startsWith("\x89PNG") || ascii.startsWith("II*\0") || ascii.startsWith("MM\0*") ||
        ascii.startsWith("RIFF") && ["WAVE", "AVI ", "WEBP"].some((kind) => ascii.slice(8, 12) === kind);
      if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "AVI ") detectedSuffix = ".avi";
      if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") detectedSuffix = ".wav";
    } catch { compatibleHeader = !/\.(mp3|mp4|mov)$/i.test(file.name); }
    if (!compatibleHeader && /\.(png|bmp|jpe?g|gif|webp|tiff?|wav)$/i.test(file.name)) {
      if (revision === submitted.current) setCover(file);
    } else if (!compatibleHeader) {
      try {
        const details = await api.probeMedia(file);
        if (revision === submitted.current) setSourceDetails(details);
      } catch (error) { if (revision === submitted.current) setCoverError(errorText(error)); }
    } else if (revision === submitted.current) setCover(detectedSuffix && !file.name.toLowerCase().endsWith(detectedSuffix)
      ? new File([file], file.name.replace(/\.[^.]+$/, "") + detectedSuffix, {type: detectedSuffix === ".avi" ? "video/x-msvideo" : "audio/wav"})
      : file);
  }

  async function prepareCover() {
    if (!sourceCover) return;
    const revision = ++submitted.current;
    setPrepareBusy(true);
    setCoverError("");
    try {
      const prepared = await api.prepareMedia(sourceCover, {
        start: Number(segmentStart), duration: Number(segmentDuration), fps: Number(segmentFps),
        max_width: Number(videoMaxWidth), max_height: Number(videoMaxHeight),
      });
      const file = await fetchAsFile(prepared.file);
      if (revision === submitted.current) {setCover(file); setConversion({sourceName: sourceCover.name,
        start: Number(segmentStart), duration: Number(segmentDuration), fps: Number(segmentFps),
        maxWidth: Number(videoMaxWidth), maxHeight: Number(videoMaxHeight), output: prepared.conversion.output_format});}
    } catch (error) { if (revision === submitted.current) setCoverError(errorText(error)); }
    finally { if (revision === submitted.current) setPrepareBusy(false); }
  }

  const payloadName = mode === "text" ? "message.txt" : payloadFile?.name ?? "";
  const payloadType = mode === "text" ? "text/plain" : payloadFile ? payloadFile.type || "application/octet-stream" : "";
  const payloadSize = useMemo(
    () => (mode === "text" ? new TextEncoder().encode(text).length : payloadFile?.size ?? 0),
    [mode, text, payloadFile],
  );
  useEffect(() => {
    let live = true;
    setPayloadDigest("");
    const bytes = mode === "text" ? new TextEncoder().encode(text) : payloadFile;
    if (!bytes || (mode === "text" && !text)) return;
    (async () => {
      const digest = await crypto.subtle.digest("SHA-256", bytes instanceof File ? await bytes.arrayBuffer() : bytes);
      if (live) setPayloadDigest(Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join(""));
    })().catch(() => undefined);
    return () => { live = false; };
  }, [mode, text, payloadFile]);

  const pemForBits = useDebounced(privatePem, 400);
  useEffect(() => {
    if (!pemForBits.trim()) return;
    let live = true;
    api.inspectKey(pemForBits, keyPassword || undefined)
      .then((key) => {
        if (live && key.bits) setKeyBits(key.bits);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pemForBits, keyPassword]);

  const estimateInput = useDebounced(
    JSON.stringify([info?.descriptor ?? null, info?.kind ?? null, cover?.name ?? null, payloadName, payloadType, payloadSize, team, keyBits]),
    250,
  );
  useEffect(() => {
    const [descriptor, kind, coverName, name, type, size, teamName, bits] =
      JSON.parse(estimateInput) as [string | null, string | null, string | null, string, string, number, string, number];
    if (!descriptor || !kind || coverName === null || !name) {
      setPackageBytes(null);
      return;
    }
    let live = true;
    api.estimate({ cover_kind: kind, descriptor, cover_filename: coverName, payload_filename: name, payload_type: type,
      payload_size: size, team: teamName, key_bits: bits })
      .then((estimate) => live && setPackageBytes(estimate.package_bytes))
      .catch(() => live && setPackageBytes(null));
    return () => {
      live = false;
    };
  }, [estimateInput]);

  const capacity = info?.capacity?.[nLsb - 1]?.max_package_bytes ?? null;
  const fits = packageBytes !== null && capacity !== null && packageBytes <= capacity;
  const overCapacity = packageBytes !== null && capacity !== null && packageBytes > capacity;
  const hasPayload = mode === "text" ? text.length > 0 : payloadFile !== null;
  const usingVaultKey = Boolean(vault.privatePem) && privatePem === vault.privatePem;

  const missing = embedMissing({
    hasCover: cover !== null,
    hasCoverDetails: info !== null,
    hasPayload,
    hasPassphrase: passphrase.length > 0,
    hasPrivateKey: privatePem.trim().length > 0,
    overCapacity,
  });
  const ready = missing.length === 0;

  async function submit() {
    if (!cover) return;
    setBusy(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("cover", cover, cover.name);
    if (mode === "text") form.append("payload_file", new Blob([text], { type: "text/plain" }), "message.txt");
    else if (payloadFile) form.append("payload_file", payloadFile, payloadFile.name);
    form.append("passphrase", passphrase);
    form.append("private_key", privatePem);
    if (keyPassword) form.append("key_password", keyPassword);
    form.append("n_lsb", String(nLsb));
    form.append("start_mode", startMode);
    form.append("team", team);
    if (startMode === "manual") {
      if (info?.kind === "audio") {
        form.append("start_seconds", startSeconds);
      } else {
        form.append("start_x", startX);
        form.append("start_y", startY);
      }
    }
    try {
      const revision = submitted.current;
      const response = await api.hide(form);
      if (revision !== submitted.current) return;
      setResult(response);
      setUsedCover(cover);
      onShowResult(true);
      void fetchAsFile(response.stego).then((stego) => {
        if (revision === submitted.current) onHandoff({ id: crypto.randomUUID(), stego, cover, sourceCover, conversion,
          passphrase, publicPem: vault.publicPem, serial: Date.now() });
      }).catch(() => undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function handOff(page: Page) {
    if (!result || !usedCover) return;
    try {
      const stego = await fetchAsFile(result.stego);
      onHandoff({ id: crypto.randomUUID(), stego, cover: usedCover, sourceCover, conversion, passphrase, publicPem: vault.publicPem, serial: Date.now() });
      goTo(page);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const manualSlot = info?.kind === "image" && info.width
    ? (Number(startY) * info.width + Number(startX)) * 3
    : info?.kind === "audio" && info.sample_rate && info.channels
      ? Math.round(Number(startSeconds) * info.sample_rate) * info.channels
      : null;

  const report = result?.report;
  const stegoUrl = result ? fileUrl(result.stego.id) : "";

  const startSummary = startMode === "auto"
    ? "hidden start point"
    : info?.kind === "audio"
      ? `start at ${startSeconds} s`
      : `start at (${startX}, ${startY})`;
  const optionsSummary = `${depthPhrase(info?.kind, nLsb)} · ${startSummary}`;

  const roomReading = packageBytes === null || capacity === null
    ? undefined
    : overCapacity
      ? `${Math.ceil(packageBytes / Math.max(1, capacity))}× too large`
      : packageBytes / capacity > 0.75 ? "nearly full" : "plenty left";

  // A reload or a deep link to /embed/result has no result in memory. Fall back to the form and
  // put the address bar back in agreement with what is on screen. Guarded so React's Strict
  // Mode double-invocation in development cannot fire the correction twice and flip the URL
  // back after the first correction already landed.
  const hasResult = result !== null && report !== undefined;
  const correctedRef = useRef(false);
  useEffect(() => {
    if (showResult && !hasResult && !correctedRef.current) {
      correctedRef.current = true;
      onShowResult(false);
    }
    if (!showResult) correctedRef.current = false;
  }, [showResult, hasResult, onShowResult]);

  // The result replaces the form rather than being appended below it.
  if (cover && /\.avi$/i.test(cover.name)) {
    return <VideoEmbed cover={cover} source={sourceCover} conversion={conversion} onHandoff={onHandoff} />;
  }
  if (showResult && result && report) {
    return (
      <Reveal><EmbedResult report={report} stego={result.stego} usedCoverUrl={usedCoverUrl} stegoUrl={stegoUrl}
        team={team} onEdit={() => onShowResult(false)} onHandOff={handOff} /></Reveal>
    );
  }

  return (
    <>
      <div className="form-column">
        <Panel step="1" title="Pick the picture or sound to hide it in"
          subtitle="PNG, BMP, JPEG, GIF, WEBP, TIFF or a WAV recording."
          aside={info && (
            <span className={`chip ${info.lossy_source ? "warn" : "flat"}`}>
              {info.lossy_source ? `${info.format} · will be saved as ${info.output_format}` : `${info.output_format} · stays lossless`}
            </span>
          )}>
          <DropZone label="Cover file" id={COVER_SLOT_ID} title="Drop an image, WAV, MP3, MP4 or MOV" hint="compressed media is prepared as a lossless cover"
            accept={COVER_ACCEPT} icon="image" file={sourceCover} onFile={(file) => void selectCover(file)} />
          {sourceDetails && <div className="conversion-panel">
            <b>{sourceDetails.kind === "video" ? "Prepare silent AVI video" : "Prepare PCM WAV audio"}</b>
            <p>{sourceDetails.streams.map((s) => `${s.type}: ${s.codec}${s.width ? ` ${s.width}×${s.height}` : ""}`).join(" · ")}</p>
            {sourceDetails.kind === "video" && (() => {
              const stream = sourceDetails.streams.find((s) => s.type === "video");
              const scale = Math.min(1, Number(videoMaxWidth) / (stream?.width || 640), Number(videoMaxHeight) / (stream?.height || 360));
              const width = Math.max(2, Math.floor((stream?.width || 640) * scale / 2) * 2);
              const height = Math.max(2, Math.floor((stream?.height || 360) * scale / 2) * 2);
              const estimate = width * height * 3 * Math.ceil(Number(segmentDuration || 0) * Number(segmentFps || 0)) + 4096;
              return <p>Estimated AVI: {width}×{height}, about {formatBytes(estimate)}. Maximum: 64 MiB.</p>;
            })()}
            {sourceDetails.kind === "video" && <div className="btn-row">
              <label>Start (s)<input type="number" min="0" step="0.1" value={segmentStart} onChange={(e) => setSegmentStart(e.target.value)} /></label>
              <label>Duration (s)<input type="number" min="0.1" max="30" step="0.1" value={segmentDuration} onChange={(e) => setSegmentDuration(e.target.value)} /></label>
              <label>Frames/s<input type="number" min="1" max="30" value={segmentFps} onChange={(e) => setSegmentFps(e.target.value)} /></label>
              <label>Max width<input type="number" min="16" max="640" value={videoMaxWidth} onChange={(e) => setVideoMaxWidth(e.target.value)} /></label>
              <label>Max height<input type="number" min="16" max="360" value={videoMaxHeight} onChange={(e) => setVideoMaxHeight(e.target.value)} /></label>
            </div>}
            <p>{sourceDetails.kind === "video" ? "Output: uncompressed AVI, up to 640×360 and 64 MiB. Audio is omitted." : "Output: 16-bit PCM WAV with the source sample rate and channels."}</p>
            <button type="button" className="btn primary" onClick={() => void prepareCover()} disabled={prepareBusy}>{prepareBusy ? "Preparing…" : "Prepare cover"}</button>
            {cover && <span className="chip good">Ready: {cover.name}</span>}
          </div>}
          <ErrorNote text={coverError} />
          {info && coverUrl && (
            <div className="cover-preview">
              <div className="cover-preview-row">
                {info.kind === "image"
                  ? <img src={coverUrl} alt="Cover preview" />
                  : <Waveform src={coverUrl} color="#5b6878" />}
                <div className="facts">
                  <span>
                    <b>{info.kind === "image" ? `${info.width} × ${info.height}` : `${info.duration?.toFixed(2)} s`}</b>
                    {info.kind === "image" ? `picture size · ${info.mode}` : `${info.channels} ch · ${info.bits}-bit · ${info.sample_rate} Hz`}
                  </span>
                  <span><b>{info.n_slots.toLocaleString()}</b>places to hide bits</span>
                  <span><b>{info.output_format}</b>saved as</span>
                  <span><b>{formatBytes(info.file_size ?? cover?.size ?? 0)}</b>current size</span>
                </div>
              </div>
              {info.lossy_source && (
                <div className="note note-warn"><Icon name="alert" />
                  <span>
                    <b>JPEG loses detail every time it is saved.</b>
                    The picture is read once and the protected copy is written as a lossless {info.output_format}, which
                    does not. Never re-save that file as a JPEG afterwards — it would destroy the hidden data.
                  </span>
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel step="2" title="Choose what to hide"
          aside={
            <div className="segmented">
              <button type="button" className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>Message</button>
              <button type="button" className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>File</button>
            </div>
          }>
          {mode === "text" ? (
            <div className="field">
              <label htmlFor={messageId}>Message</label>
              <textarea id={messageId} ref={messageRef} className="message" value={text}
                onChange={(event) => setText(event.target.value)} placeholder="Type the message you want to hide…" />
              <div className="field-foot">
                <small className="field-hint">{payloadSize.toLocaleString()} bytes (UTF-8)</small>
                <small className="field-hint">
                  Example text:{" "}
                  <button type="button" className="link-btn" onClick={() => setText(SHORT_MESSAGE)}>short</button>
                  {" · "}
                  <button type="button" className="link-btn" onClick={() => setText(LONG_MESSAGE)}>long</button>
                  {text.length > 0 && (
                    <>
                      {" · "}
                      <button type="button" className="link-btn" onClick={() => setText("")}>clear</button>
                    </>
                  )}
                </small>
              </div>
            </div>
          ) : (
            <DropZone label="File to hide" id={PAYLOAD_SLOT_ID} title="Drop any file to hide"
              hint="it is encrypted, signed and hidden byte for byte" icon="file" file={payloadFile}
              onFile={setPayloadFile} tone={overCapacity ? "bad" : ""} />
          )}

          {hasPayload && <div className="hash-evidence"><div className="hash-heading"><h2>Payload SHA-256 before embedding</h2></div>
            <p>{payloadName} · {payloadSize.toLocaleString()} bytes · {payloadType}</p>
            <code>{payloadDigest || "Calculating…"}</code>
            <p>Exact payload bytes will be preserved. Capacity includes encryption and signature overhead.</p>
          </div>}

          {overCapacity && packageBytes !== null && capacity !== null && (
            <div className="note note-error" role="alert">
              <Icon name="alert" />
              <span>
                <b>This is too big for {cover?.name}.</b>
                It needs {packageBytes.toLocaleString()} bytes and this cover holds {capacity.toLocaleString()} bytes.
                <span className="note-actions">
                  <button type="button" className="btn ghost sm"
                    onClick={() => document.getElementById(COVER_SLOT_ID)?.focus()}>Choose a larger cover</button>
                  <button type="button" className="btn ghost sm" onClick={() => {
                    if (mode === "text") messageRef.current?.focus();
                    else document.getElementById(PAYLOAD_SLOT_ID)?.focus();
                  }}>Choose something smaller</button>
                  <button type="button" className="btn ghost sm" onClick={() => {
                    setOptionsOpen(true);
                    window.setTimeout(() => depthRef.current?.querySelector<HTMLElement>("button")?.focus(), 0);
                  }}>Use more bits per value</button>
                </span>
              </span>
            </div>
          )}

          <Meter used={packageBytes} total={capacity} label="Room in this cover" reading={roomReading} />
        </Panel>

        <EmbeddingOptions open={optionsOpen} onOpenChange={setOptionsOpen} summary={optionsSummary}
          info={info} nLsb={nLsb} onNLsb={setNLsb} capacity={capacity} depthRef={depthRef}
          startMode={startMode} onStartMode={setStartMode}
          startX={startX} startY={startY} startSeconds={startSeconds}
          onStartX={setStartX} onStartY={setStartY} onStartSeconds={setStartSeconds}
          manualSlot={manualSlot} />

        <Panel step="3" title="Lock and sign it"
          subtitle="The receiver needs the same password. Your private key proves the file came from you.">
          <PassphraseField value={passphrase} onChange={setPassphrase}
            hint={passphrase && passphrase.length < 8
              ? "Short passwords are easy to guess. Use 8+ characters."
              : "Write it down. If it is lost, the hidden content cannot be recovered."} />

          <div className="field">
            <span className="field-label">Signing key</span>
            {!privatePem.trim() && !keyEditorOpen ? (
              <div className="note note-warn">
                <Icon name="key" />
                <span>
                  <b>No key pair yet.</b>
                  You need one to sign the file.
                  <span className="note-actions">
                    <button type="button" className="btn primary sm" onClick={() => goTo("keys")}>Go to Keys</button>
                    <button type="button" className="btn ghost sm" onClick={() => setKeyEditorOpen(true)}>
                      Paste a private key instead
                    </button>
                  </span>
                </span>
              </div>
            ) : usingVaultKey && !keyEditorOpen ? (
              <div className="note note-good">
                <Icon name="key" />
                <span>
                  Using your key pair — fingerprint <span className="fingerprint">{shortHash(vault.privateFingerprint, 16)}</span>
                  {" · "}
                  <button type="button" className="link-btn" onClick={() => setKeyEditorOpen(true)}>Use a different key</button>
                </span>
              </div>
            ) : (
              <>
                <KeyField label="Sender's RSA private key" value={privatePem} onChange={setPrivatePem}
                  placeholder="-----BEGIN PRIVATE KEY----- (drop private_key.pem here)"
                  vaultPem={vault.privatePem} vaultLabel="Use key from Keys page" />
                <div className="field">
                  <label htmlFor={keyPasswordId}>Private key password</label>
                  <input id={keyPasswordId} type="password" value={keyPassword} placeholder="only if the .pem is encrypted"
                    onChange={(event) => setKeyPassword(event.target.value)} />
                </div>
                {usingVaultKey && (
                  <button type="button" className="link-btn self-start" onClick={() => setKeyEditorOpen(false)}>
                    Hide these fields
                  </button>
                )}
              </>
            )}
          </div>

          <div className="field">
            <label htmlFor={labelId}>Label <span className="muted">(optional)</span></label>
            <input id={labelId} className="narrow-input" type="text" value={team} maxLength={200} placeholder="e.g. P1-4"
              onChange={(event) => setTeam(event.target.value)} />
            <small className="field-hint">Stored inside the file and shown to the receiver. Use it to mark your team or batch.</small>
          </div>
        </Panel>

        <ErrorNote text={error} />

        <ActionBar missing={missing}
          heading={ready ? "Ready" : undefined}
          detail={ready && info
            ? info.lossy_source
              ? `${cover?.name} is a JPEG, so the protected copy is written as ${info.output_format}.`
              : `${cover?.name} stays lossless, so it will look and sound identical.`
            : undefined}>
          {(reasonId) => (
            <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={submit}
              aria-describedby={reasonId} aria-busy={busy}>
              {busy ? <Spinner /> : <Icon name="shield" />} {busy ? "Working…" : "Embed & sign"}
            </button>
          )}
        </ActionBar>
        <p className="sr-live" role="status" aria-live="polite">
          {busy ? "Hashing, signing, encrypting and embedding." : ""}
        </p>
      </div>

    </>
  );
}

import { EmbeddingOptions } from "./embed/Options";
import { EmbedResult } from "./embed/Result";
