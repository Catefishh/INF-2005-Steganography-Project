import { useEffect, useRef, useState } from "react";
import { api, fileUrl, type Scenario } from "../api";
import {
  ActionBar, Disclosure, DropZone, ErrorNote, Icon, KeyField, Outcome, Panel, PassphraseField, Spinner, StaleBanner, VerdictChip,
} from "../components";
import { tamperMissing } from "../requirements";
import { changedInputs, staleReason } from "../stale";
import { errorText, type Handoff, type Vault } from "../util";
import { RobustnessPanel } from "./RobustnessPanel";

const STEGO_ACCEPT = "image/*,.png,.bmp,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.wav,audio/wav";
const STEGO_SLOT_ID = "tamper-file-slot";
const COVER_SLOT_ID = "tamper-cover-slot";

const INPUT_LABELS = ["file", "original", "password", "public key"];

/** Tests that only run when the original cover was supplied, because they attack it. */
const NEEDS_ORIGINAL = new Set(["clean_cover", "wrong_start", "flip_payload_bit", "click"]);

/** The test that should come back clean. */
const POSITIVE_ID = "baseline";

export function AttackPage({ vault, handoff, goTo }: { vault: Vault; handoff: Handoff | null; goTo: (page: "keys") => void }) {
  const [stego, setStego] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [publicPem, setPublicPem] = useState("");
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [resultInputs, setResultInputs] = useState<string[] | null>(null);
  const [staleDismissed, setStaleDismissed] = useState(false);
  const outcomeRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!handoff) return;
    setStego(handoff.stego);
    setCover(handoff.cover);
    setPassphrase(handoff.passphrase);
    if (handoff.publicPem) setPublicPem(handoff.publicPem);
    setScenarios(null);
    setResultInputs(null);
  }, [handoff]);

  useEffect(() => {
    if (vault.publicPem) setPublicPem(vault.publicPem);
  }, [vault.publicPem]);

  async function run() {
    if (!stego) return;
    // Snapshot before the await, so the staleness comparison is against what was really sent.
    const snapshot = [stego.name, cover?.name ?? "", passphrase, publicPem];
    setBusy(true);
    setError("");
    setScenarios(null);
    setResultInputs(null);
    setStaleDismissed(false);
    const form = new FormData();
    form.append("stego", stego, stego.name);
    if (cover) form.append("cover", cover, cover.name);
    form.append("passphrase", passphrase);
    form.append("public_key", publicPem);
    try {
      setScenarios((await api.attacks(form)).scenarios);
      setResultInputs(snapshot);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const currentInputs = [stego?.name ?? "", cover?.name ?? "", passphrase, publicPem];
  const changed = resultInputs ? changedInputs(INPUT_LABELS, resultInputs, currentInputs) : [];
  const stale = scenarios !== null && changed.length > 0 && !staleDismissed;

  const usingVaultKey = Boolean(vault.publicPem) && publicPem === vault.publicPem;
  const hasPublicKey = publicPem.trim().length > 0;
  const missing = tamperMissing({ hasFile: stego !== null, hasPassphrase: passphrase.length > 0, hasPublicKey });
  const ready = missing.length === 0;

  const passed = scenarios?.filter((s) => s.as_expected).length ?? 0;
  const negatives = scenarios?.filter((s) => s.expected[0] !== "Authentic").length ?? 0;
  const saved = scenarios?.filter((s) => s.file !== null).length ?? 0;
  const positives = scenarios ? scenarios.length - negatives : 0;

  // The outcome is the point of the screen, so it takes focus and is announced.
  useEffect(() => {
    if (scenarios) outcomeRef.current?.focus();
  }, [scenarios]);

  return (
    <div className="form-column">
      <Panel step="1" title="The protected file to attack"
        subtitle="Start from a file that currently passes the check. Each test changes one thing and runs the normal checker on the result.">
        <div className="columns">
          <DropZone label={<>Protected file <span className="req">· required</span></>} id={STEGO_SLOT_ID}
            title="Drop the protected file" hint="picture or WAV produced by Embed & Sign"
            accept={STEGO_ACCEPT} icon="shield" file={stego}
            onFile={(file) => { setStego(file); setScenarios(null); }} />
          <DropZone label={<>Original, before anything was hidden <span className="opt">(optional)</span></>} id={COVER_SLOT_ID}
            title="Drop the original here" hint="adds the tests that attack the original file"
            accept={STEGO_ACCEPT} icon="image" file={cover}
            onFile={(file) => { setCover(file); setScenarios(null); }} />
        </div>
      </Panel>

      <Panel step="2" title="What the checker will be given">
        <PassphraseField value={passphrase} onChange={setPassphrase}
          hint="Carried over from Embed & Sign, because the tests need a password that works in order to prove the failures are caused by the damage and nothing else." />

        <div className="field">
          <span className="field-label">Sender's public key</span>
          {!hasPublicKey && !keyEditorOpen ? (
            <div className="note note-warn">
              <Icon name="key" />
              <span>
                <b>No public key yet.</b>
                Without it the signature checks cannot run.
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
                Using the public key from your key pair — fingerprint <span className="fingerprint">{`${vault.publicFingerprint?.slice(0, 16) ?? ""}…`}</span>
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

        <ErrorNote text={error} />
      </Panel>

      <ActionBar missing={missing}
        heading={ready ? "Ready" : undefined}
        detail={ready
          ? cover
            ? "Runs the whole suite, including the tests that attack the original. Takes a few seconds."
            : "Runs the suite. Add the original to unlock the tests that attack it. Takes a few seconds."
          : undefined}>
        {(reasonId) => (
          <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={run}
            aria-describedby={reasonId} aria-busy={busy}>
            {busy ? <Spinner /> : <Icon name="zap" />} {busy ? "Running the tests…" : "Run tamper tests"}
          </button>
        )}
      </ActionBar>
      <p className="sr-live" role="status" aria-live="polite">
        {busy ? "Damaging the file one way at a time and running the checker on each result." : ""}
      </p>

      {scenarios && (
        <>
          {stale && (
            <StaleBanner reason={staleReason(changed)} busy={busy} onRerun={run} onDismiss={() => setStaleDismissed(true)} />
          )}
          <div className={`result-column${stale ? " stale" : ""}`}>
            <Outcome tone={passed === scenarios.length ? "good" : "bad"}
              icon={passed === scenarios.length ? "shield" : "alert"}
              label="Result"
              title={`${passed} of ${scenarios.length} behaved correctly`}
              headingRef={outcomeRef}
              summary={
                <>
                  {positives === 1 ? "The one file that should pass, passed. " : `All ${positives} files that should pass, passed. `}
                  {negatives === 0
                    ? "No test should have been rejected, so there is nothing to catch."
                    : `All ${numberWord(negatives)} damaged files were rejected, each for the right reason.`}
                  {saved > 0 && ` ${numberWord(saved)} of the damaged files were kept and can be saved below.`}
                  {passed < scenarios.length && " The rows in red did not behave as expected."}
                </>
              }
              actions={
                <button type="button" className="btn ghost" onClick={run} disabled={busy} aria-busy={busy}>
                  {busy ? <Spinner /> : <Icon name="refresh" size={16} />} Run again
                </button>
              } />

            <div className="table-wrap">
              <table className="attacks">
                <thead>
                  <tr><th className="col-test">Test</th><th className="col-result">Result</th><th className="col-file">Damaged file</th></tr>
                </thead>
                <tbody>
                  {scenarios.map((scenario) => (
                    <tr key={scenario.id} className={scenario.as_expected ? "" : "mismatch"}>
                      <td>
                        <strong>{scenario.title}</strong>
                        <p className="attack-what">{scenario.change} {expectation(scenario, Boolean(cover))}</p>
                      </td>
                      <td>
                        <VerdictChip verdict={scenario.verdict} />
                        {scenario.as_expected
                          ? <div className="attack-ok">as expected</div>
                          : <div className="attack-bad">expected {scenario.expected.join(" or ")}</div>}
                        <Disclosure title="Why">
                          <p className="small">{scenario.summary}</p>
                        </Disclosure>
                      </td>
                      <td>
                        {scenario.file ? (
                          <a className="btn ghost sm" href={fileUrl(scenario.file.id, true)} download={scenario.file.filename}>
                            <Icon name="download" size={13} /> Save {scenario.file.filename}
                          </a>
                        ) : (
                          <span className="muted small">{noFileReason(scenario, Boolean(cover))}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <RobustnessPanel />
    </div>
  );
}

/**
 * The expected verdict, folded into the test description. The two either-or tests say why either
 * answer is correct, which is the whole reason the separate Expected column could be dropped.
 */
export function expectation(scenario: Scenario, hasCover: boolean): string {
  const alternatives = scenario.expected.join(" or ");
  if (scenario.expected.length > 1) {
    return `Either ${scenario.expected[0]} or ${scenario.expected[1]} is correct here, because which check fails `
      + "first depends on what the damaged data happens to look like.";
  }
  if (!hasCover && NEEDS_ORIGINAL.has(scenario.id)) {
    return `Should come back ${alternatives} once the original file is supplied.`;
  }
  return `Should come back ${alternatives}.`;
}

/** Why a row has no file. "–" says nothing; these say which of the two reasons it is. */
export function noFileReason(scenario: Scenario, hasCover: boolean): string {
  if (scenario.id === POSITIVE_ID) return "not damaged";
  if (!hasCover) return "needs the original file";
  return "original file used";
}

export function numberWord(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return words[n] ?? String(n);
}
