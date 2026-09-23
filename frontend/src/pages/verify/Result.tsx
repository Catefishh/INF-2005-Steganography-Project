import { useEffect, useRef, useState } from "react";
import { api, fileUrl, type CoverInfo, type SignedRecord, type VerifyResponse } from "../../api";
import {
  ActionBar, Disclosure, DropZone, ErrorNote, Icon, InputStrip, KeyField, MediaPreview, Outcome, Panel,
  PassphraseField, Spinner, StaleBanner, VerifySteps,
} from "../../components";
import { verifyMissing } from "../../requirements";
import { changedInputs, staleReason } from "../../stale";
import { errorText, formatBytes, shortHash, useObjectUrl, type Handoff, type Page, type Vault } from "../../util";
import { failedStep, skippedSteps, stepsValue, verdictReading } from "../../verdict";

export function VerifyResult({ result, stegoName, overrideUsed, passphrase, onPassphrase, busy, outcomeRef, onCheckAgain, onEdit, onInspect, onOverrideOff }: {
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
