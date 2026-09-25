import { useEffect, useRef, useState } from "react";
import { api, fileUrl, type CoverInfo, type SignedRecord, type VerifyResponse } from "../api";
import {
  ActionBar, Disclosure, DropZone, ErrorNote, Icon, InputStrip, KeyField, MediaPreview, Outcome, Panel,
  PassphraseField, Spinner, StaleBanner, VerifySteps,
} from "../components";
import { verifyMissing } from "../requirements";
import { changedInputs, staleReason } from "../stale";
import { errorText, formatBytes, shortHash, useObjectUrl, type Handoff, type Page, type Vault } from "../util";
import { VideoVerify } from "./VideoWorkflow";
import { failedStep, skippedSteps, stepsValue, verdictReading } from "../verdict";

const STEGO_ACCEPT = "image/*,.png,.bmp,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.wav,audio/wav";
const STEGO_SLOT_ID = "verify-file-slot";

/** The inputs a verdict is a statement about. Named so the stale banner can name them too. */
const INPUT_LABELS = ["file", "password", "public key", "start point"];

/**
 * "2 minutes ago" from the hand-off timestamp. Carried-over state has to say *when* it arrived,
 * because otherwise a file loaded twelve minutes ago reads exactly like one just produced.
 */
export function relativeTime(from: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Shown only while the override is armed, so an active override can never be missed. */
const OVERRIDE_WARNING = "With it on, the hidden data is read from the place you type here instead of the place "
  + "stored in the file. Normal checks will fail. Turn it off to check a file properly.";

export function VerifyPage({ vault, handoff, onWorkingFile, goTo, showResult, onShowResult }: {
  vault: Vault;
  handoff: Handoff | null;
  onWorkingFile?: (file: File | null) => void;
  goTo: (page: Page) => void;
  /** True when the route asks for /verify/result. */
  showResult: boolean;
  /** Moves the route between the form and the result. */
  onShowResult: (show: boolean) => void;
}) {
  const [stego, setStego] = useState<File | null>(null);
  const requestRevision = useRef(0);
  const [info, setInfo] = useState<CoverInfo | null>(null);
  const [fromHandoff, setFromHandoff] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [publicPem, setPublicPem] = useState("");
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);
  const [override, setOverride] = useState(false);
  // Pre-filled from the file's real start point, not from zero: the override is meant to show
  // what looking in the *wrong* place does, so it has to start from the right one.
  const [overrideX, setOverrideX] = useState("0");
  const [overrideY, setOverrideY] = useState("0");
  const [overrideSeconds, setOverrideSeconds] = useState("0.000");
  const [overrideSlot, setOverrideSlot] = useState("");
  const [attempts, setAttempts] = useState<{location: string; verdict: string}[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VerifyResponse | null>(null);
  /** The inputs the current result describes. Null while there is no result. */
  const [resultInputs, setResultInputs] = useState<string[] | null>(null);
  /** True while the user has chosen to keep looking at a result they know is out of date. */
  const [staleDismissed, setStaleDismissed] = useState(false);

  const stegoUrl = useObjectUrl(stego);
  const outcomeRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!handoff) return;
    requestRevision.current += 1;
    setStego(handoff.stego);
    setPassphrase(handoff.passphrase);
    if (handoff.publicPem) setPublicPem(handoff.publicPem);
    setFromHandoff(true);
    setResult(null);
  }, [handoff]);

  useEffect(() => {
    if (vault.publicPem) setPublicPem(vault.publicPem);
  }, [vault.publicPem]);

  useEffect(() => {
    setInfo(null);
    setOverride(false);
    if (!stego) return;
    let live = true;
    api.inspect(stego).then((details) => live && setInfo(details)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [stego]);

  // Every newly described file re-seeds the position fields, so the override always opens on the
  // real start point of whatever is loaded. Anything the user typed is theirs until then.
  useEffect(() => {
    const start = info?.header;
    if (!start) return;
    if (info?.kind === "audio") setOverrideSeconds(Number(start.seconds ?? 0).toFixed(3));
    else {
      setOverrideX(String(start.x ?? 0));
      setOverrideY(String(start.y ?? 0));
    }
  }, [info]);

  const startSignature = override && info?.embedding_method !== "dct"
    ? info?.kind === "audio"
      ? `s:${overrideSeconds}`
      : `xy:${overrideX},${overrideY}`
    : "from the password";
  const currentInputs = [stego?.name ?? "", passphrase, publicPem, startSignature];
  const changed = resultInputs ? changedInputs(INPUT_LABELS, resultInputs, currentInputs) : [];
  const stale = result !== null && changed.length > 0 && !staleDismissed;

  const overrideValue = override && info?.embedding_method !== "dct"
    ? info?.kind === "audio"
      ? `ON · ${Number(overrideSeconds || 0).toFixed(3)} s`
      : `ON · (${overrideX || 0}, ${overrideY || 0})`
    : "off";

  const usingVaultKey = Boolean(vault.publicPem) && publicPem === vault.publicPem;
  const hasPublicKey = publicPem.trim().length > 0;
  const missing = verifyMissing({
    hasFile: stego !== null,
    hasPassphrase: passphrase.length > 0,
    hasPublicKey,
    needsRecheck: stale,
  });
  const ready = missing.length === 0;

  async function submit(useOverride = override) {
    if (!stego) return;
    const requestId = ++requestRevision.current;
    // Snapshot before the await: state read after it belongs to a later render.
    const sentOverride = useOverride && info?.embedding_method !== "dct";
    const sentStart = overrideSlot !== "" ? `slot:${overrideSlot}` : info?.kind === "audio" ? `s:${overrideSeconds}` : `xy:${overrideX},${overrideY}`;
    const snapshot = [stego.name, passphrase, publicPem, sentOverride ? sentStart : "from the password"];
    setBusy(true);
    setError("");
    if (!showResult) setResult(null);
    setResultInputs(null);
    setStaleDismissed(false);
    const form = new FormData();
    form.append("stego", stego, stego.name);
    form.append("passphrase", passphrase);
    form.append("public_key", publicPem);
    if (sentOverride) {
      if (overrideSlot !== "") form.append("start_slot", overrideSlot);
      else if (info?.kind === "audio") {
        form.append("start_seconds", overrideSeconds);
      } else {
        form.append("start_x", overrideX);
        form.append("start_y", overrideY);
      }
    }
    try {
      const response = await api.verify(form);
      if (requestId !== requestRevision.current) return;
      setResult(response);
      setResultInputs(snapshot);
      setAttempts((before) => [...before, { location: sentOverride ? sentStart : "authenticated stored location", verdict: response.verdict }]);
      onShowResult(true);
    } catch (e) {
      if (requestId === requestRevision.current) setError(errorText(e));
    } finally {
      if (requestId === requestRevision.current) setBusy(false);
    }
  }

  const hasResult = result !== null;
  const correctedRef = useRef(false);
  useEffect(() => {
    if (showResult && !hasResult && !correctedRef.current) {
      correctedRef.current = true;
      onShowResult(false);
    }
    if (!showResult) correctedRef.current = false;
  }, [showResult, hasResult, onShowResult]);

  // The outcome must be the first thing read, not something to scroll to find.
  useEffect(() => {
    if (showResult && result) outcomeRef.current?.focus();
  }, [showResult, result]);

  /** Back to the form, with the override already off so a re-run reads the file's own start. */
  function overrideOff() {
    setOverride(false);
    void submit(false);
  }

  if (handoff && /\.avi$/i.test(handoff.stego.name)) {
    return <VideoVerify handoff={handoff} onWorkingFile={onWorkingFile} />;
  }

  if (showResult && result) {
    return (
      <>
        {stale && (
          <StaleBanner reason={staleReason(changed)} busy={busy} onRerun={() => void submit()}
            onDismiss={() => setStaleDismissed(true)} />
        )}
        <div className={`reveal result-column${stale ? " stale" : ""}`}>
          <VerifyResult result={result} stegoName={stego?.name ?? "the file"}
            overrideUsed={resultInputs !== null && resultInputs[3] !== "from the password"}
            passphrase={passphrase} onPassphrase={setPassphrase} busy={busy}
            outcomeRef={outcomeRef} onCheckAgain={() => void submit()} onEdit={() => onShowResult(false)}
            onInspect={() => goTo("analyse")} onOverrideOff={overrideOff} />
          {result.verdict === "Wrong Start Location" && <div className="retry-panel">
            <h2>Retry on this file</h2>
            <p>Enter a corrected location or use the authenticated stored location.</p>
            <div className="btn-row">
              <label>Exact slot<input type="number" min="0" value={overrideSlot} onChange={(e) => setOverrideSlot(e.target.value)} /></label>
              {info?.kind === "audio" ? <label>Time (seconds)<input type="number" min="0" step="0.001" value={overrideSeconds} onChange={(e) => { setOverrideSeconds(e.target.value); setOverrideSlot(""); }} /></label> : <>
                <label>X<input type="number" min="0" value={overrideX} onChange={(e) => { setOverrideX(e.target.value); setOverrideSlot(""); }} /></label>
                <label>Y<input type="number" min="0" value={overrideY} onChange={(e) => { setOverrideY(e.target.value); setOverrideSlot(""); }} /></label>
              </>}
            </div>
            <div className="btn-row"><button type="button" className="btn primary" disabled={busy} onClick={() => { setOverride(true); void submit(true); }}>Retry extraction</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={overrideOff}>Use stored location and retry</button></div>
          </div>}
          {attempts.length > 1 && <details><summary>Previous attempts ({attempts.length})</summary><ol>{attempts.map((attempt, i) => <li key={i}>{attempt.location}: {attempt.verdict}</li>)}</ol></details>}
        </div>
      </>
    );
  }

  return (
    <div className="form-column">
      <Panel step="1" title="The file you received">
        {fromHandoff && handoff && (
          <div className="note note-info">
            <Icon name="send" />
            <span>
              <b>Loaded from Embed &amp; Sign, {relativeTime(handoff.serial)}.</b>
              <span className="note-actions">
                <button type="button" className="btn ghost sm" onClick={() => document.getElementById(STEGO_SLOT_ID)?.focus()}>
                  Use a different file
                </button>
              </span>
            </span>
          </div>
        )}
        <DropZone label="File to check" id={STEGO_SLOT_ID} title="Drop the protected picture or sound clip"
          hint="or click to browse" accept={STEGO_ACCEPT} icon="eye" file={stego}
          onFile={(file) => { requestRevision.current += 1; setStego(file); onWorkingFile?.(file); setFromHandoff(false); setResult(null); setAttempts([]); }} />
        {info?.kind === "audio" && stegoUrl && (
          <MediaPreview url={stegoUrl} mime="audio/wav" name={stego?.name ?? "received file"} />
        )}
        {info && (
          <div className="facts">
            <span>
              <b>{info.kind === "image" ? `${info.width} × ${info.height}` : `${info.duration?.toFixed(2)} s`}</b>
              {info.kind === "image" ? `picture · ${info.mode}` : `${info.channels} ch · ${info.bits}-bit · ${info.sample_rate} Hz`}
            </span>
            <span><b>{info.n_slots.toLocaleString()}</b>places to look in</span>
            <span><b>{formatBytes(info.file_size ?? stego?.size ?? 0)}</b>size</span>
          </div>
        )}
      </Panel>

      <Panel step="2" title="What you need to open it"
        subtitle="The password unlocks the content; the sender's public key checks the signature.">
        <PassphraseField value={passphrase} onChange={setPassphrase}
          placeholder="The password the sender told you" />

        <div className="field">
          <span className="field-label">Sender's public key</span>
          {!hasPublicKey && !keyEditorOpen ? (
            <div className="note note-warn">
              <Icon name="key" />
              <span>
                <b>No public key yet.</b>
                Without it the signature cannot be checked.
                <span className="note-actions">
                  <button type="button" className="btn primary sm" onClick={() => goTo("keys")}>Go to Keys</button>
                  <button type="button" className="btn ghost sm" onClick={() => setKeyEditorOpen(true)}>
                    Paste a public key instead
                  </button>
                </span>
              </span>
            </div>
          ) : usingVaultKey && !keyEditorOpen ? (
            <div className="note note-good">
              <Icon name="key" />
              <span>
                Using the public key from your key pair — fingerprint <span className="fingerprint">{shortHash(vault.publicFingerprint, 16)}</span>
                {" · "}
                <button type="button" className="link-btn" onClick={() => setKeyEditorOpen(true)}>Use a different key</button>
              </span>
            </div>
          ) : (
            <>
              <KeyField label="Sender's RSA public key" value={publicPem} onChange={setPublicPem}
                placeholder="-----BEGIN PUBLIC KEY----- (drop public_key.pem here)"
                vaultPem={vault.publicPem} vaultLabel="Use key from Keys page" />
              {usingVaultKey && (
                <button type="button" className="link-btn self-start" onClick={() => setKeyEditorOpen(false)}>
                  Hide this field
                </button>
              )}
            </>
          )}
        </div>

        {info?.embedding_method !== "dct" && <Disclosure title="Look in a specific place instead of using the password" value={overrideValue} tone={override ? "warn" : ""}>
          {override && (
            <div className="note note-warn">
              <Icon name="alert" />
              <span><b>This is a demonstration switch.</b> {OVERRIDE_WARNING}</span>
            </div>
          )}
          <div className="inline-fields">
            <div className="field">
              <span className="field-label">Override</span>
              <div className="segmented">
                <button type="button" className={override ? "" : "on"} aria-pressed={!override}
                  onClick={() => setOverride(false)}>Off</button>
                <button type="button" className={override ? "on warn" : ""} aria-pressed={override}
                  onClick={() => setOverride(true)}>On</button>
              </div>
            </div>
            {info?.kind === "audio" ? (
              <label>Seconds from the start
                <input type="number" min={0} step={0.001} value={overrideSeconds} disabled={!override}
                  onChange={(event) => setOverrideSeconds(event.target.value)} />
              </label>
            ) : (
              <>
                <label>X
                  <input type="number" min={0} value={overrideX} disabled={!override}
                    onChange={(event) => setOverrideX(event.target.value)} />
                </label>
                <label>Y
                  <input type="number" min={0} value={overrideY} disabled={!override}
                    onChange={(event) => setOverrideY(event.target.value)} />
                </label>
              </>
            )}
            <small className="field-hint">
              {info?.header
                ? `The header is at ${info.header.text}; it is not the payload start. The authenticated payload start becomes available after unlocking.`
                : "The payload start becomes available after unlocking the file."}
            </small>
          </div>
        </Disclosure>}

        <ErrorNote text={error} />
      </Panel>

      <ActionBar missing={missing}
        heading={ready ? (override ? "Ready — with the override on" : "Ready") : undefined}
        detail={ready
          ? override
            ? info?.kind === "audio"
              ? `Reading from ${Number(overrideSeconds || 0).toFixed(3)} s, not from the place in the file.`
              : `Reading from (${overrideX || 0}, ${overrideY || 0}), not from the place in the file.`
            : undefined
          : undefined}
        tone={ready && override ? "warn" : ""}>
        {(reasonId) => (
          <>
            {override && (
              <button type="button" className="btn ghost" onClick={() => setOverride(false)}>
                <Icon name="x" size={15} /> Turn the override off
              </button>
            )}
          <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={() => void submit()}
              aria-describedby={reasonId} aria-busy={busy}>
              {busy ? <Spinner /> : <Icon name="eye" />} {busy ? "Checking…" : "Check file"}
            </button>
          </>
        )}
      </ActionBar>
      <p className="sr-live" role="status" aria-live="polite">
        {busy ? "Reading the file, decrypting the directory and checking the signature." : ""}
      </p>
    </div>
  );
}

/**
 * The result, ranked by what the receiver came for: the outcome, then the content, then who
 * sent it, then the evidence, then the inputs that produced it.
 */

import { VerifyResult } from "./verify/Result";
