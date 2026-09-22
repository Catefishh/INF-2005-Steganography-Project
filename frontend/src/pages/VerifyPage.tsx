import { useEffect, useRef, useState } from "react";
import { api, fileUrl, type CoverInfo, type SignedRecord, type VerifyResponse } from "../api";
import {
  ActionBar, Disclosure, DropZone, ErrorNote, Icon, InputStrip, KeyField, MediaPreview, Outcome, Panel,
  PassphraseField, Spinner, StaleBanner, VerifySteps,
} from "../components";
import { verifyMissing } from "../requirements";
import { changedInputs, staleReason } from "../stale";
import { errorText, formatBytes, shortHash, useObjectUrl, type Handoff, type Page, type Vault } from "../util";
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

export const OVERRIDE_HINT = "Not carried over from Embed & Sign on purpose — a real receiver has to type it in.";

/** Shown only while the override is armed, so an active override can never be missed. */
const OVERRIDE_WARNING = "With it on, the hidden data is read from the place you type here instead of the place "
  + "stored in the file. Normal checks will fail. Turn it off to check a file properly.";

export function VerifyPage({ vault, handoff, goTo, showResult, onShowResult }: {
  vault: Vault;
  handoff: Handoff | null;
  goTo: (page: Page) => void;
  /** True when the route asks for /verify/result. */
  showResult: boolean;
  /** Moves the route between the form and the result. */
  onShowResult: (show: boolean) => void;
}) {
  const [stego, setStego] = useState<File | null>(null);
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
    setStego(handoff.stego);
    setFromHandoff(true);
    setResult(null);
  }, [handoff]);

  useEffect(() => {
    if (vault.publicPem) setPublicPem(vault.publicPem);
  }, [vault.publicPem]);

  useEffect(() => {
    setInfo(null);
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

  const startSignature = override
    ? info?.kind === "audio"
      ? `s:${overrideSeconds}`
      : `xy:${overrideX},${overrideY}`
    : "from the password";
  const currentInputs = [stego?.name ?? "", passphrase, publicPem, startSignature];
  const changed = resultInputs ? changedInputs(INPUT_LABELS, resultInputs, currentInputs) : [];
  const stale = result !== null && changed.length > 0 && !staleDismissed;

  const overrideValue = override
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

  async function submit() {
    if (!stego) return;
    // Snapshot before the await: state read after it belongs to a later render.
    const sentOverride = override;
    const sentStart = info?.kind === "audio" ? `s:${overrideSeconds}` : `xy:${overrideX},${overrideY}`;
    const snapshot = [stego.name, passphrase, publicPem, sentOverride ? sentStart : "from the password"];
    setBusy(true);
    setError("");
    setResult(null);
    setResultInputs(null);
    setStaleDismissed(false);
    const form = new FormData();
    form.append("stego", stego, stego.name);
    form.append("passphrase", passphrase);
    form.append("public_key", publicPem);
    if (sentOverride) {
      if (info?.kind === "audio") {
        form.append("start_seconds", overrideSeconds);
      } else {
        form.append("start_x", overrideX);
        form.append("start_y", overrideY);
      }
    }
    try {
      const response = await api.verify(form);
      setResult(response);
      setResultInputs(snapshot);
      onShowResult(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
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
    onShowResult(false);
  }

  if (showResult && result) {
    return (
      <>
        {stale && (
          <StaleBanner reason={staleReason(changed)} busy={busy} onRerun={() => void submit()}
            onDismiss={() => setStaleDismissed(true)} />
        )}
        <div className={`result-column${stale ? " stale" : ""}`}>
          <VerifyResult result={result} stegoName={stego?.name ?? "the file"}
            overrideUsed={resultInputs !== null && resultInputs[3] !== "from the password"}
            passphrase={passphrase} onPassphrase={setPassphrase} busy={busy}
            outcomeRef={outcomeRef} onCheckAgain={() => void submit()} onEdit={() => onShowResult(false)}
            onInspect={() => goTo("analyse")} onOverrideOff={overrideOff} />
        </div>
      </>
    );
  }

  return (
    <div className="form-column">
      <Panel step="1" title="The file you received"
        subtitle="Drag in the file the sender gave you. Nothing about it needs to be known in advance.">
        {fromHandoff && handoff && (
          <div className="note note-info">
            <Icon name="send" />
            <span>
              <b>Carried over from Embed &amp; Sign, {relativeTime(handoff.serial)}.</b>
              Handy for testing your own file. If you are checking something that actually arrived by email, replace it.
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
          onFile={(file) => { setStego(file); setFromHandoff(false); setResult(null); }} />
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
        subtitle="The password the sender gave you in person, and their public key.">
        <PassphraseField value={passphrase} onChange={setPassphrase}
          placeholder="The password the sender told you"
          hint={OVERRIDE_HINT} />

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

        <Disclosure title="Look in a specific place instead of using the password" value={overrideValue} tone={override ? "warn" : ""}>
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
                ? `The file says the hidden data starts at ${info.header.text}. The app reads from there unless this switch is on.`
                : "The real start point appears here once the file has loaded."}
            </small>
          </div>
        </Disclosure>

        <ErrorNote text={error} />
      </Panel>

      <ActionBar missing={missing}
        heading={ready ? (override ? "Ready — with the override on" : "Ready") : undefined}
        detail={ready
          ? override
            ? info?.kind === "audio"
              ? `Reading from ${Number(overrideSeconds || 0).toFixed(3)} s, not from the place in the file.`
              : `Reading from (${overrideX || 0}, ${overrideY || 0}), not from the place in the file.`
            : `${stego?.name} will be opened with the password you typed.`
          : undefined}
        tone={ready && override ? "warn" : ""}>
        {(reasonId) => (
          <>
            {override && (
              <button type="button" className="btn ghost" onClick={() => setOverride(false)}>
                <Icon name="x" size={15} /> Turn the override off
              </button>
            )}
            <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={submit}
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
function VerifyResult({ result, stegoName, overrideUsed, passphrase, onPassphrase, busy, outcomeRef, onCheckAgain, onEdit, onInspect, onOverrideOff }: {
  result: VerifyResponse;
  stegoName: string;
  overrideUsed: boolean;
  passphrase: string;
  onPassphrase: (value: string) => void;
  busy: boolean;
  outcomeRef: React.RefObject<HTMLHeadingElement | null>;
  onCheckAgain: () => void;
  onEdit: () => void;
  onInspect: () => void;
  onOverrideOff: () => void;
}) {
  const reading = verdictReading(result.verdict);
  const failed = failedStep(result.steps);
  const skipped = skippedSteps(result.steps);
  const record = result.record;
  const content = result.content;
  const wrongPlace = result.verdict === "Wrong Start Location" && overrideUsed;

  return (
    <>
      <Outcome tone={reading.tone} icon={reading.icon} label={`Verdict · ${reading.verdict}`} title={reading.headline}
        headingRef={outcomeRef}
        summary={
          <>
            {reading.summary}
            {failed && <> The check that stopped it was <b>{failed.title}</b>.</>}
          </>
        }
        actions={wrongPlace ? (
          <button type="button" className="btn ghost" onClick={onOverrideOff}>
            <Icon name="refresh" size={15} /> Turn the override off and check again
          </button>
        ) : undefined} />

      {content && record && (
        <div className="columns">
          <Panel title="What was hidden inside"
            aside={<span className="chip flat">{content.filename} · {formatBytes(content.size)}</span>}>
            <div className="extracted">
              {content.text !== undefined && content.media_type.startsWith("text/") ? (
                <p className="extracted-text">{content.text}</p>
              ) : (
                <MediaPreview url={fileUrl(content.id)} mime={content.media_type} name={content.filename} text={content.text} />
              )}
              {content.text_truncated && <small className="field-hint">Preview truncated. Download it for the whole thing.</small>}
              <div className="btn-row">
                <a className="btn ghost" href={fileUrl(content.id, true)} download={content.filename}>
                  <Icon name="download" /> Download {content.filename} ({formatBytes(content.size)})
                </a>
              </div>
            </div>
          </Panel>

          <Panel title="Who sent it">
            <div className="table-wrap">
              <table className="kv">
                <tbody>
                  <tr>
                    <th>Signed by</th>
                    <td className="mono">
                      {shortHash(record.signer_fingerprint, 16)}{" "}
                      {result.record_trusted
                        ? <span className="chip good">matches your key</span>
                        : <span className="chip bad">untrusted</span>}
                    </td>
                  </tr>
                  <tr><th>Created</th><td>{record.timestamp}</td></tr>
                  <tr><th>Label</th><td>{record.team || "not set"}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="field-hint">
              These three come from the signed record, so they cannot be altered without the signature failing.
            </p>
          </Panel>
        </div>
      )}

      {(reading.verdict === "Cannot Verify" || wrongPlace) && (
        <Panel title="Most likely fix" className="recovery">
          {wrongPlace ? (
            <>
              <p>
                The password was accepted, so the file is intact. It says the hidden data starts somewhere else.
                Turning the override off makes the app read the place the file records.
              </p>
              <div className="btn-row">
                <button type="button" className="btn primary" onClick={onOverrideOff}>
                  <Icon name="refresh" size={15} /> Turn the override off and check again
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Retype the password and check again. It is needed to find where the hidden data starts, so a single
                wrong character stops everything.
              </p>
              <div className="recovery-row">
                <PassphraseField value={passphrase} onChange={onPassphrase}
                  placeholder="The password the sender told you" hint="Case-sensitive. Spaces count." />
                <button type="button" className="btn primary" onClick={onCheckAgain} disabled={busy || !passphrase} aria-busy={busy}>
                  {busy ? <Spinner /> : <Icon name="refresh" size={15} />} Check again
                </button>
              </div>
              <p className="field-hint">
                If the password is definitely right, the file was probably re-compressed or edited on the way here.
                Ask the sender to send the original again, or{" "}
                <button type="button" className="link-btn" onClick={onInspect}>inspect it for traces</button>.
              </p>
            </>
          )}
        </Panel>
      )}

      <Disclosure title="What was checked" value={stepsValue(result.steps)} defaultOpen={reading.tone !== "good"}>
        <VerifySteps steps={result.steps.filter((step) => step.status !== "skipped")} />
        {skipped.length > 0 && <SkippedSteps steps={skipped} />}
      </Disclosure>

      {record && (
        <Disclosure title="Full record and hashes" value={`${FULL_RECORD_ROWS.length} fields`}>
          <div className="table-wrap">
            <table className="kv">
              <tbody>
                {FULL_RECORD_ROWS.map(([label, read]) => (
                  <tr key={label}><th>{label}</th><td className="mono">{read(record)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <Disclosure title="Raw record as it was signed" value="JSON">
            <pre className="raw-json">{JSON.stringify(record, null, 2)}</pre>
          </Disclosure>
        </Disclosure>
      )}

      <InputStrip
        items={[
          { label: "Checked", value: stegoName, icon: "eye" },
          { label: "Password", value: "supplied" },
          { label: "Public key", value: record ? shortHash(record.signer_fingerprint, 12) : "supplied" },
          { label: "Start point", value: overrideUsed ? "overridden by you" : "from the password" },
        ]}
        actions={
          <>
            <button type="button" className="btn ghost sm" onClick={onEdit}>
              <Icon name="pen" size={14} /> Change and check again
            </button>
            <button type="button" className="btn ghost sm" onClick={onEdit}>Check another file</button>
          </>
        } />
    </>
  );
}

/** The seven record rows that answer "which file exactly", below the three that answer "who". */
const FULL_RECORD_ROWS: [string, (record: SignedRecord) => string][] = [
  ["Media ID", (r) => r.media_id],
  ["Nonce", (r) => r.nonce],
  ["Cover", (r) => `${r.cover?.filename} (${r.cover?.descriptor})`],
  ["Cover SHA-256", (r) => r.cover?.sha256],
  ["Hidden content", (r) => `${r.payload?.filename} · ${r.payload?.media_type} · ${r.payload?.size} B`],
  ["Content SHA-256", (r) => r.payload?.sha256],
  ["How it was hidden", (r) => `${r.embedding?.method}, ${r.embedding?.lsb_bits} bit(s), start position ${Number(r.embedding?.start_slot).toLocaleString()}`],
];

/**
 * Five "Not reached" rows would fill the column for no information. One line names all five and
 * expands on request.
 */
function SkippedSteps({ steps }: { steps: ReturnType<typeof skippedSteps> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="skips">
      <Icon name="minus" size={15} />
      <div>
        {steps.length} later check{steps.length === 1 ? " was" : "s were"} not reached:{" "}
        {steps.map((step) => step.title.toLowerCase()).join(", ")}.{" "}
        <button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide them" : "Show them"}
        </button>
        {open && <VerifySteps steps={steps} />}
      </div>
    </div>
  );
}
