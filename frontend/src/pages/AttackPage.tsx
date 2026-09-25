import { useEffect, useRef, useState } from "react";
import { api, fileUrl, type Scenario } from "../api";
import {
  ActionBar, Disclosure, DropZone, ErrorNote, Icon, KeyField, Outcome, Panel, PassphraseField, Spinner, StaleBanner, VerdictChip,
} from "../components";
import { tamperMissing } from "../requirements";
import { changedInputs, staleReason } from "../stale";
import { errorText, type Handoff, type Vault } from "../util";
import { artifactUrl, requestJson, type Job } from "../api/jobs";
import { TextShowcase } from "./TextShowcase";

const STEGO_ACCEPT = "image/*,audio/*,video/*,.png,.bmp,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.wav,.mp3,.mp4,.mov,.avi";
const STEGO_SLOT_ID = "tamper-file-slot";
const COVER_SLOT_ID = "tamper-cover-slot";

const INPUT_LABELS = ["file", "original", "password", "public key"];

/** Only the clean-cover check requires the original image or recording. */
const NEEDS_ORIGINAL = new Set(["clean_cover"]);

/** The test that should come back clean. */
const POSITIVE_ID = "baseline";

export function AttackPage({ vault, handoff, onWorkingFile, goTo }: { vault: Vault; handoff: Handoff | null; onWorkingFile?: (file: File | null) => void; goTo: (page: "keys") => void }) {
  const [stego, setStego] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [media, setMedia] = useState<"binary" | "text">("binary");
  const [passphrase, setPassphrase] = useState("");
  const [publicPem, setPublicPem] = useState("");
  const [recovery, setRecovery] = useState<File | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState("");
  const [jobPhase, setJobPhase] = useState("");
  const [jobTotal, setJobTotal] = useState(0);
  const [error, setError] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<Scenario | null>(null);
  const [resultInputs, setResultInputs] = useState<string[] | null>(null);
  const [staleDismissed, setStaleDismissed] = useState(false);
  const outcomeRef = useRef<HTMLHeadingElement>(null);
  const requestRevision = useRef(0);

  useEffect(() => {
    if (!handoff) return;
    requestRevision.current += 1;
    setStego(handoff.stego);
    setCover(handoff.cover);
    setPassphrase(handoff.passphrase);
    setRecovery(handoff.recovery ?? null);
    setRecoveryCode(handoff.recoveryCode ?? "");
    if (handoff.publicPem) setPublicPem(handoff.publicPem);
    setScenarios(null);
    setSelectedVariant(null);
    setResultInputs(null);
  }, [handoff]);

  useEffect(() => {
    if (vault.publicPem && !/\.avi$/i.test(stego?.name ?? "")) setPublicPem(vault.publicPem);
  }, [vault.publicPem, stego?.name]);

  async function run() {
    if (!stego) return;
    const requestId = ++requestRevision.current;
    // Snapshot before the await, so the staleness comparison is against what was really sent.
    const snapshot = [stego?.name ?? "", cover?.name ?? "", passphrase, publicPem];
    setBusy(true);
    setError("");
    setScenarios(null);
    setResultInputs(null);
    setStaleDismissed(false);
    const form = new FormData();
    form.append("stego", stego, stego.name);
    if (cover) form.append("cover", cover, cover.name);
    if (handoff?.conversion) form.append("conversion_settings", JSON.stringify(handoff.conversion));
    form.append("passphrase", passphrase);
    form.append("public_key", publicPem);
    if (recovery) form.append("recovery", recovery);
    if (recoveryCode) form.append("recovery_code", recoveryCode);
    try {
      await requestJson("/api/v2/session", { method: "POST" });
      const started = await requestJson<Job<{cases: Scenario[]}>>("/api/v4/jobs/showcase", { method: "POST", body: form });
      if (requestId !== requestRevision.current) return;
      setJobId(started.id);
      for (let attempt = 0; attempt < 1200; attempt++) {
        const state = await requestJson<Job<{cases: Scenario[]}> & {cases: Scenario[]; total: number}>(`/api/v2/jobs/${encodeURIComponent(started.id)}`);
        if (requestId !== requestRevision.current) return;
        setJobPhase(state.phase); setJobTotal(state.total); setScenarios(state.cases);
        if (state.status === "succeeded") {
          setScenarios(state.result?.cases ?? state.cases);
          break;
        }
        if (state.status === "failed") throw new Error(state.error?.message || "Showcase failed");
        if (state.status === "cancelled") break;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      setResultInputs(snapshot);
    } catch (e) {
      if (requestId === requestRevision.current) setError(errorText(e));
    } finally {
      if (requestId === requestRevision.current) setBusy(false);
    }
  }

  const currentInputs = [stego?.name ?? "", cover?.name ?? "", passphrase, publicPem];
  const changed = resultInputs ? changedInputs(INPUT_LABELS, resultInputs, currentInputs) : [];
  const stale = scenarios !== null && changed.length > 0 && !staleDismissed;

  const usingVaultKey = Boolean(vault.publicPem) && publicPem === vault.publicPem;
  const isVideo = /\.avi$/i.test(stego?.name ?? "");
  const hasPublicKey = publicPem.trim().length > 0;
  const missing = isVideo ? [!stego && "protected AVI", !recovery && "recovery file", !recoveryCode && "recovery code", !hasPublicKey && "Ed25519 public key"].filter(Boolean) as string[] :
    tamperMissing({ hasFile: stego !== null, hasPassphrase: passphrase.length > 0, hasPublicKey });
  const ready = missing.length === 0;

  const applicable = scenarios?.filter((s) => s.verdict !== "Unsupported") ?? [];
  const unsupported = (scenarios?.length ?? 0) - applicable.length;
  const passed = applicable.filter((s) => s.as_expected).length;
  const negatives = applicable.filter((s) => s.expected[0] !== "Authentic").length;
  const rejectedAsExpected = applicable.filter((s) => s.expected[0] !== "Authentic" && s.as_expected).length;
  const tamperingEvidence = applicable.filter((s) => s.verdict === "Tampered" || s.verdict === "Signature Invalid").length;
  const inconclusive = applicable.filter((s) => s.verdict === "Cannot Verify").length;
  const saved = scenarios?.filter((s) => s.file !== null).length ?? 0;
  const baseline = scenarios?.find((s) => s.id === POSITIVE_ID);

  // The outcome is the point of the screen, so it takes focus and is announced.
  useEffect(() => {
    if (scenarios) outcomeRef.current?.focus();
  }, [scenarios]);

  if (media === "text") return <TextShowcase back={() => setMedia("binary")} onWorkingFile={onWorkingFile}
    initialCarrier={handoff?.stego ?? null} initialRecovery={handoff?.recovery ?? null}
    initialCode={handoff?.recoveryCode ?? ""} initialPublicKey={handoff?.publicPem ?? ""} />;

  return (
    <div className="form-column">
      <button type="button" className="btn ghost sm" onClick={() => setMedia("text")}>Text carrier tests</button>
      <Panel step="1" title="Choose the protected file"
        subtitle="Use a file that passes Extract & Verify.">
        <ol className="tamper-guide">
          <li><strong>Baseline:</strong> verify the protected file without changes.</li>
          <li><strong>One change:</strong> edit a copy or change a credential for each case.</li>
          <li><strong>Compare:</strong> show expected and observed verdicts; download modified files.</li>
        </ol>
        <div className="columns">
          <DropZone label={<>Protected file <span className="req">· required</span></>} id={STEGO_SLOT_ID}
            title="Drop the protected file" hint="image, audio, or video file produced by Embed & Sign"
            accept={`${STEGO_ACCEPT},.avi,video/x-msvideo`} icon="shield" file={stego}
            onFile={(file) => { requestRevision.current += 1; setStego(file); onWorkingFile?.(file); setScenarios(null); }} />
          <DropZone label={<>Original cover <span className="opt">(optional)</span></>} id={COVER_SLOT_ID}
            title="Drop the original here" hint="adds a check that the original contains no hidden payload"
            accept={`${STEGO_ACCEPT},.avi,video/x-msvideo`} icon="image" file={cover}
            onFile={(file) => { setCover(file); setScenarios(null); }} />
        </div>
      </Panel>

      <Panel step="2" title="Verification inputs">
        {!isVideo && <PassphraseField value={passphrase} onChange={setPassphrase}
          hint="The baseline uses this password; the wrong-password case replaces it for that check." />
        }
        {isVideo && <div className="inline-fields"><label>Recovery file<input type="file" accept=".stegloc" onChange={(e) => setRecovery(e.target.files?.[0] ?? null)} /></label>
          <label>Recovery code<input value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} /></label></div>}

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

      <ActionBar missing={missing} heading={ready ? "Ready" : undefined}>
        {(reasonId) => (
          <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={() => void run()}
            aria-describedby={reasonId} aria-busy={busy}>
            {busy ? <Spinner /> : <Icon name="zap" />} {busy ? "Running the tests…" : "Run tamper tests"}
          </button>
        )}
      </ActionBar>
      <p className="sr-live" role="status" aria-live="polite">
        {busy ? `Running ${jobPhase}: ${scenarios?.length ?? 0} of ${jobTotal || "?"} cases complete.` : ""}
      </p>

      {busy && jobId && <button type="button" className="btn ghost" onClick={() => void requestJson(`/api/v2/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" })}>Cancel suite</button>}
      {jobId && <a className="btn ghost" href={`/api/v4/jobs/${encodeURIComponent(jobId)}/evidence`} download="stegloc-v4-evidence.zip">Download evidence ZIP</a>}

      {scenarios && scenarios.length > 0 && (
        <>
          {stale && (
            <StaleBanner reason={staleReason(changed)} busy={busy} onRerun={run} onDismiss={() => setStaleDismissed(true)} />
          )}
          <div className={`result-column${stale ? " stale" : ""}`}>
            <Outcome tone={passed === applicable.length ? "good" : "bad"}
              icon={passed === applicable.length ? "shield" : "alert"}
              label="Result"
               title={baseline?.verdict === "Authentic" ? "Baseline file is genuine" : "Baseline file could not be confirmed genuine"}
               headingRef={outcomeRef}
               summary={
                 <>
                    {baseline?.verdict === "Authentic" ? "The baseline is genuine and its integrity checks passed." : `The baseline could not be confirmed genuine (${baseline?.verdict ?? "not run"}).`}
                    {tamperingEvidence > 0 && ` ${tamperingEvidence} test${tamperingEvidence === 1 ? " found" : "s found"} evidence of tampering or an invalid signature.`}
                    {inconclusive > 0 && ` ${inconclusive} result${inconclusive === 1 ? " is" : "s are"} inconclusive; authenticity could not be established.`}
                    {negatives > 0 && ` ${rejectedAsExpected} of ${negatives} negative checks produced their expected outcomes.`}
                   {saved > 0 && ` ${saved} modified file${saved === 1 ? " is" : "s are"} available to download.`}
                   {unsupported > 0 && ` ${unsupported} spatial-LSB cases do not apply to this DCT file.`}
                    {passed < applicable.length && " Some checks produced unexpected results; review the evidence below."}
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
                    <tr><th className="col-test">Test</th><th className="col-result">Expected outcome / observed result</th><th className="col-file">Modified file</th></tr>
                </thead>
                <tbody>
                  {scenarios.map((scenario) => (
                    <tr key={scenario.id} className={scenario.as_expected ? "" : "mismatch"}>
                      <td>
                        <strong>{scenario.title}</strong>
                        <p className="attack-what"><b>Change:</b> {scenario.change}</p>
                      </td>
                      <td>
                        <div className="attack-expected"><b>Expected outcome:</b> {expectation(scenario, Boolean(cover))}</div>
                        <div className="attack-observed"><b>Observed:</b>{" "}
                        {scenario.verdict === "Unsupported" ? <span className="chip flat">Unsupported</span> : <><VerdictChip verdict={scenario.verdict} /><span className="small"> {observation(scenario)}</span></>}
                        </div>
                        {scenario.verdict === "Unsupported" ? <div className="muted small">not applicable</div> : scenario.as_expected
                          ? <div className="attack-ok">as expected</div>
                          : <div className="attack-bad">expected {scenario.expected.join(" or ")}</div>}
                        <Disclosure title="Why">
                          <p className="small">{scenario.summary}</p>
                          {scenario.elapsed_ms !== undefined && <p className="small">Elapsed: {scenario.elapsed_ms.toLocaleString()} ms</p>}
                          {scenario.stages && <p className="small">Stages: {scenario.stages.map((stage) => `${stage.id} ${stage.status}`).join(" · ")}</p>}
                          {scenario.payload_hash && <div className="hash-evidence"><b>Payload SHA-256 · {scenario.payload_hash.status}</b>
                            <p>Signed expected: <code>{scenario.payload_hash.expected ?? "Not reached"}</code> {scenario.payload_hash.expected_trusted ? "(trusted)" : "(not yet trusted)"}</p>
                            <p>Computed decoded: <code>{scenario.payload_hash.computed ?? "Not reached"}</code></p></div>}
                        </Disclosure>
                      </td>
                      <td>
                        {scenario.file ? (
                          <div className="btn-row"><a className="btn ghost sm" href={artifactUrl(scenario.file.id)} download={scenario.file.filename}>
                            <Icon name="download" size={13} /> Save {scenario.file.filename}
                          </a><button type="button" className="btn ghost sm" onClick={() => setSelectedVariant(scenario)}>Examine variant</button></div>
                        ) : (
                          <span className="muted small">{noFileReason(scenario, Boolean(cover))}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedVariant?.file && <Panel title="Selected test variant" subtitle="This is a separate test copy. The baseline working file remains unchanged.">
              <p><strong>{selectedVariant.file.filename}</strong> · {selectedVariant.file.size.toLocaleString()} bytes</p>
              <h3>Change made</h3><p>{selectedVariant.change}</p>
              <h3>Verification result</h3><p>{observation(selectedVariant)} Expected: {expectation(selectedVariant, Boolean(cover))} Observed verdict: {selectedVariant.verdict}.</p>
              <p>{selectedVariant.summary}</p>
              {selectedVariant.stages && selectedVariant.stages.length > 0 && <><h3>Checks reached</h3><ul className="variant-stages">{selectedVariant.stages.map((stage) => <li key={stage.id}><strong>{stage.id.replaceAll("_", " ")}</strong>: {stage.status}</li>)}</ul></>}
              {selectedVariant.elapsed_ms !== undefined && <p className="muted small">Verification took {selectedVariant.elapsed_ms.toLocaleString()} ms.</p>}
              <a className="btn ghost" href={artifactUrl(selectedVariant.file.id)} download={selectedVariant.file.filename}>Download this variant</a>
            </Panel>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The expected verdict, folded into the test description. The two either-or tests say why either
 * answer is correct, which is the whole reason the separate Expected column could be dropped.
 */
export function expectation(scenario: Scenario, hasCover: boolean): string {
  if (scenario.verdict === "Unsupported") return "Not applicable (spatial LSB only).";
  const outcomes: Record<string, string> = {
    baseline: "The correct passphrase is accepted, the signature is valid, and the file is confirmed genuine.",
    wrong_passphrase: "The incorrect passphrase is rejected; the file cannot be authenticated with it.",
    wrong_key: "The unrelated public key does not validate the sender's signature.",
    flip_cover_bit: "The changed file is identified as tampered because data outside the payload changed.",
    flip_payload_bit: "The changed file is identified as tampered because the protected payload changed.",
    wrong_start: "The selected location is rejected; the file itself remains unchanged.",
    corrected_start: "The authenticated location succeeds and the unchanged file is confirmed genuine.",
    clean_cover: "No signed payload is found in the original cover.",
    jpeg: "The re-compressed file is rejected or cannot be verified because its protected data may no longer be readable.",
    lsb_noise: "The overwritten file is rejected or cannot be verified because the hidden payload was disrupted.",
    forged_payload: "The modified content is rejected because its signature is invalid.",
    payload_hash_mismatch: "The payload is identified as tampered because its content no longer matches the signed digest.",
    click: "The edited audio is identified as tampered.",
  };
  const outcome = outcomes[scenario.id] ?? `The result indicates ${scenario.expected.join(" or ")}.`;
  return !hasCover && NEEDS_ORIGINAL.has(scenario.id) ? `${outcome} Add the original cover to run this check.` : outcome;
}

export function observation(scenario: Scenario): string {
  if (scenario.verdict === "Authentic") return "The file is genuine; the authenticity and integrity checks passed.";
  if (scenario.verdict === "Tampered") return "There is evidence of tampering: an integrity check detected a change.";
  if (scenario.verdict === "Signature Invalid") return "There is evidence of an invalid or replaced signature; authenticity was not established.";
  if (scenario.verdict === "Cannot Verify") return scenario.id === "wrong_passphrase"
    ? "The supplied passphrase was not accepted, so authenticity could not be checked."
    : "Inconclusive: the file could not be verified, so this result does not by itself prove tampering.";
  if (scenario.verdict === "Payload Missing") return "No recognizable signed payload was found; this alone does not prove tampering.";
  if (scenario.verdict === "Wrong Start Location") return "The chosen location did not contain the payload; this does not indicate a file change.";
  return "The test could not be applied to this file type.";
}

/** Why a row has no file. "–" says nothing; these say which of the two reasons it is. */
export function noFileReason(scenario: Scenario, hasCover: boolean): string {
  if (scenario.verdict === "Unsupported") return "not applicable to DCT";
  if (scenario.id === POSITIVE_ID) return "file unchanged";
  if (scenario.id === "clean_cover") return hasCover ? "original cover used" : "requires original cover";
  if (["wrong_passphrase", "wrong_key", "wrong_start", "corrected_start"].includes(scenario.id))
    return "file unchanged; check settings changed";
  return "no modified file";
}

export function numberWord(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return words[n] ?? String(n);
}
