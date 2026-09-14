import { useEffect, useMemo, useState } from "react";
import { api, fetchAsFile, fileUrl, type CoverInfo, type HideResponse } from "../api";
import {
  ByteDiagram, CompareSlider, DropZone, ErrorNote, HideTimeline, Icon, KeyField, LectureTable, MediaPreview, Meter,
  Panel, PassphraseField, Spinner, Stat, Waveform,
} from "../components";
import { LONG_MESSAGE, SHORT_MESSAGE } from "../samples";
import { errorText, formatBytes, shortHash, useDebounced, useObjectUrl, type Handoff, type Page, type Vault } from "../util";

const COVER_ACCEPT = "image/*,.png,.bmp,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.wav,audio/wav";

export function HidePage({ vault, onHandoff, goTo }: { vault: Vault; onHandoff: (handoff: Handoff) => void; goTo: (page: Page) => void }) {
  const [cover, setCover] = useState<File | null>(null);
  const [info, setInfo] = useState<CoverInfo | null>(null);
  const [coverError, setCoverError] = useState("");
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState(SHORT_MESSAGE);
  const [payloadFile, setPayloadFile] = useState<File | null>(null);
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

  const coverUrl = useObjectUrl(cover);
  const usedCoverUrl = useObjectUrl(usedCover);

  useEffect(() => {
    if (vault.privatePem) setPrivatePem(vault.privatePem);
  }, [vault.privatePem]);

  useEffect(() => {
    setInfo(null);
    setCoverError("");
    if (!cover) return;
    let live = true;
    api.inspect(cover)
      .then((details) => live && setInfo(details))
      .catch((e: unknown) => live && setCoverError(errorText(e)));
    return () => {
      live = false;
    };
  }, [cover]);

  const payloadName = mode === "text" ? "message.txt" : payloadFile?.name ?? "";
  const payloadType = mode === "text" ? "text/plain" : payloadFile ? payloadFile.type || "application/octet-stream" : "";
  const payloadSize = useMemo(
    () => (mode === "text" ? new TextEncoder().encode(text).length : payloadFile?.size ?? 0),
    [mode, text, payloadFile],
  );

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
  const hasPayload = mode === "text" ? text.length > 0 : payloadFile !== null;
  const ready = Boolean(cover && info && hasPayload && passphrase && privatePem.trim());

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
      const response = await api.hide(form);
      setResult(response);
      setUsedCover(cover);
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
      onHandoff({ stego, cover: usedCover, passphrase, publicPem: vault.publicPem, serial: Date.now() });
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

  return (
    <div className="page-grid">
      <div className="columns">
        <div className="column">
          <Panel step="1" title="Cover object" subtitle="Image (PNG, BMP, JPEG, GIF, WEBP, TIFF) or PCM WAV audio. Drag and drop your own file.">
            <DropZone title="Drop a cover image or WAV" hint="or click to browse" accept={COVER_ACCEPT} icon="image"
              file={cover} onFile={(file) => { setCover(file); setResult(null); }} />
            <ErrorNote text={coverError} />
            {info && coverUrl && (
              <div className="cover-preview">
                {info.kind === "image" ? <img src={coverUrl} alt="Cover preview" /> : <Waveform src={coverUrl} color="#5b6878" />}
                <div className="facts">
                  <span><b>{info.kind === "image" ? `${info.width} × ${info.height}` : `${info.duration?.toFixed(2)} s`}</b>
                    {info.kind === "image" ? `${info.mode} · ${info.format}` : `${info.channels} ch · ${info.bits}-bit · ${info.sample_rate} Hz`}</span>
                  <span><b>{info.n_slots.toLocaleString()}</b>slots</span>
                  <span><b>{info.output_format}</b>stego format</span>
                </div>
                {info.lossy_source && (
                  <div className="note note-warn"><Icon name="alert" />
                    <span>JPEG input is lossy. The pixels are decoded once and the stego image is saved as lossless PNG. Never re-save the stego file as JPEG.</span>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel step="2" title="Payload" subtitle="Any text or any file (document, image, audio, video...).">
            <div className="segmented">
              <button type="button" className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>Secret message</button>
              <button type="button" className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>File</button>
            </div>
            {mode === "text" ? (
              <>
                <div className="preset-row">
                  <span className="muted small">Brief samples:</span>
                  <button type="button" className="pill" onClick={() => setText(SHORT_MESSAGE)}>Short (Learning Outcome 1)</button>
                  <button type="button" className="pill" onClick={() => setText(LONG_MESSAGE)}>Large (Project Overview)</button>
                  <button type="button" className="pill" onClick={() => setText("")}>Clear</button>
                </div>
                <textarea className="message" value={text} onChange={(event) => setText(event.target.value)}
                  placeholder="Type the message to hide…" />
                <small className="field-hint">{payloadSize.toLocaleString()} bytes (UTF-8)</small>
              </>
            ) : (
              <DropZone title="Drop any file to hide" hint="it is encrypted, signed and hidden byte for byte" icon="file"
                file={payloadFile} onFile={setPayloadFile} />
            )}
          </Panel>
        </div>

        <div className="column">
          <Panel step="3" title="LSB embedding" subtitle="Number of least significant bits replaced in every slot.">
            <div className="lsb-picker" role="radiogroup" aria-label="Number of LSBs">
              {Array.from({ length: 8 }, (_, index) => index + 1).map((n) => (
                <button key={n} type="button" role="radio" aria-checked={nLsb === n}
                  className={`lsb-btn${nLsb === n ? " on" : ""}${n > 3 ? " risky" : ""}`} onClick={() => setNLsb(n)}
                  title={info?.capacity ? `${info.capacity[n - 1].max_package_bytes.toLocaleString()} bytes capacity` : undefined}>
                  {n}
                </button>
              ))}
            </div>
            <ByteDiagram nLsb={nLsb} />
            {nLsb > 3 && <p className="muted small">More than 3 LSBs raises capacity but the changes may become visible or audible.</p>}
            <div className="field">
              <label>Capacity check</label>
              <Meter used={packageBytes} total={capacity} />
              <small className="field-hint">Payload + signed record + RSA signature + AES nonce/tag. The header uses 520 extra slots at 1 LSB.</small>
            </div>

            <div className="field">
              <label>Start location</label>
              <div className="segmented">
                <button type="button" className={startMode === "auto" ? "on" : ""} onClick={() => setStartMode("auto")}>
                  <Icon name="lock" size={14} /> Secret (from passphrase)
                </button>
                <button type="button" className={startMode === "manual" ? "on" : ""} onClick={() => setStartMode("manual")}>
                  <Icon name="target" size={14} /> Manual
                </button>
              </div>
              {startMode === "auto" ? (
                <small className="field-hint">Start = HMAC-SHA256(key from passphrase, random salt). It is stored AES-encrypted in the header, so only the passphrase reveals it.</small>
              ) : info?.kind === "audio" ? (
                <div className="inline-fields">
                  <label>Time (s)<input type="number" min={0} step="0.001" max={info.duration} value={startSeconds} onChange={(event) => setStartSeconds(event.target.value)} /></label>
                  <small className="field-hint">slot {manualSlot?.toLocaleString() ?? "-"} (channel 1)</small>
                </div>
              ) : (
                <div className="inline-fields">
                  <label>X<input type="number" min={0} max={info?.width ? info.width - 1 : undefined} value={startX} onChange={(event) => setStartX(event.target.value)} /></label>
                  <label>Y<input type="number" min={0} max={info?.height ? info.height - 1 : undefined} value={startY} onChange={(event) => setStartY(event.target.value)} /></label>
                  <small className="field-hint">slot {manualSlot?.toLocaleString() ?? "-"} (red byte). Not (0, 0).</small>
                </div>
              )}
            </div>
          </Panel>

          <Panel step="4" title="Sign and protect" subtitle="The private key signs; the passphrase encrypts the start location and payload.">
            <PassphraseField value={passphrase} onChange={setPassphrase}
              hint={passphrase && passphrase.length < 8 ? "Short passphrases are easy to guess. Use 8+ characters." : undefined} />
            <KeyField label="Sender's RSA private key" value={privatePem} onChange={setPrivatePem}
              placeholder="-----BEGIN PRIVATE KEY----- (drop private_key.pem here)" vaultPem={vault.privatePem} vaultLabel="Use key from Keys page" />
            <div className="inline-fields">
              <label>Key password<input type="password" value={keyPassword} placeholder="only if encrypted" onChange={(event) => setKeyPassword(event.target.value)} /></label>
              <label>Team metadata<input type="text" value={team} maxLength={200} placeholder="e.g. P1-4" onChange={(event) => setTeam(event.target.value)} /></label>
            </div>
            <ErrorNote text={error} />
            <button type="button" className="btn primary wide" disabled={!ready || busy || (packageBytes !== null && !fits)} onClick={submit}>
              {busy ? <Spinner /> : <Icon name="shield" />} {busy ? "Hashing, signing, encrypting, embedding…" : "Embed & sign"}
            </button>
          </Panel>
        </div>
      </div>

      {result && report && (
        <Panel className="result" step="✓" title="Stego object ready"
          subtitle={`${report.n_lsb} LSB(s) · ${report.package_bytes.toLocaleString()} bytes hidden · start ${report.start.text}`}
          aside={
            <div className="btn-row">
              <a className="btn primary" href={fileUrl(result.stego.id, true)} download={result.stego.filename}><Icon name="download" /> Download {result.stego.filename}</a>
              <button type="button" className="btn ghost" onClick={() => void handOff("verify")}><Icon name="send" /> Send to receiver</button>
              <button type="button" className="btn ghost" onClick={() => void handOff("analyse")}><Icon name="layers" /> Steganalysis</button>
              <button type="button" className="btn ghost" onClick={() => void handOff("attacks")}><Icon name="zap" /> Attack lab</button>
            </div>
          }>
          <div className="stats">
            <Stat label="File size" value={report.size_unchanged ? "Unchanged" : `${report.stego_size > (report.cover.file_size ?? 0) ? "+" : ""}${formatBytes(Math.abs(report.stego_size - (report.cover.file_size ?? 0)))}`}
              sub={`${formatBytes(report.cover.file_size ?? 0)} → ${formatBytes(report.stego_size)}${report.size_unchanged ? "" : report.cover.output_format === "PNG" ? " (PNG re-compressed; pixels exact)" : ""}`}
              tone={report.size_unchanged ? "good" : ""} />
            <Stat label="PSNR" value={report.psnr_db === null ? "∞" : `${report.psnr_db.toFixed(2)} dB`} sub={`MSE ${report.mse.toExponential(2)}`} tone="good" />
            <Stat label="Bits changed" value={report.bits_changed.toLocaleString()} sub={`${report.slots_changed.toLocaleString()} of ${report.cover.n_slots.toLocaleString()} slots`} />
            <Stat label="Capacity used" value={`${report.capacity_used_percent.toFixed(1)}%`} sub={`${report.package_bytes.toLocaleString()} / ${report.capacity_bytes.toLocaleString()} bytes`} />
          </div>

          <div className="columns">
            <div className="column">
              <h4 className="sub-title">Before and after</h4>
              {report.cover.kind === "image" && usedCoverUrl ? (
                <CompareSlider before={usedCoverUrl} after={stegoUrl} />
              ) : (
                <div className="audio-compare">
                  {usedCoverUrl && <div><span className="tag">Cover</span><MediaPreview url={usedCoverUrl} mime="audio/wav" name="cover" /></div>}
                  <div><span className="tag hot">Stego</span><MediaPreview url={stegoUrl} mime="audio/wav" name="stego" /></div>
                </div>
              )}
              <div className="location-cards">
                <div><Icon name="target" /><span><b>Payload start</b>{report.start.text} · slot {report.start.slot.toLocaleString()} ({report.start_mode === "auto" ? "secret" : "manual"})</span></div>
                <div><Icon name="lock" /><span><b>Encrypted header</b>{report.header.text} · last 520 slots, 1 LSB</span></div>
              </div>
              <h4 className="sub-title">LSB replacement at the start slot (lecture view)</h4>
              <LectureTable rows={report.lecture_rows} nLsb={report.n_lsb} />
            </div>
            <div className="column">
              <h4 className="sub-title">What happened</h4>
              <HideTimeline steps={report.steps} />
              <details className="record">
                <summary>Signed verification record (SHA-256 {shortHash(report.record_sha256, 20)})</summary>
                <pre>{JSON.stringify(report.record, null, 2)}</pre>
              </details>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
