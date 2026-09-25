import { useEffect, useRef, useState } from "react";
import { api, fileUrl, type Scenario } from "../api";
import {
  ActionBar, Disclosure, DropZone, ErrorNote, Icon, KeyField, Outcome, Panel, PassphraseField, Spinner, StaleBanner, VerdictChip,
} from "../components";
import { tamperMissing } from "../requirements";
import { changedInputs, staleReason } from "../stale";
import { errorText, type Handoff, type Vault } from "../util";
import { artifactUrl, requestJson, type Job } from "../api/jobs";
import { RobustnessPanel } from "./RobustnessPanel";
import { TextShowcase } from "./TextShowcase";

const STEGO_ACCEPT = "image/*,.png,.bmp,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.wav,audio/wav";
const STEGO_SLOT_ID = "tamper-file-slot";
const COVER_SLOT_ID = "tamper-cover-slot";

const INPUT_LABELS = ["file", "original", "password", "public key"];

/** Only the clean-cover check requires the original image or recording. */
const NEEDS_ORIGINAL = new Set(["clean_cover"]);

/** The test that should come back clean. */
const POSITIVE_ID = "baseline";

export function AttackPage({ vault, handoff, onWorkingFile, onHandoff, goTo }: { vault: Vault; handoff: Handoff | null; onWorkingFile?: (file: File | null) => void; onHandoff?: (value: Handoff) => void; goTo: (page: "keys") => void }) {
  const [stego, setStego] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [mode, setMode] = useState<"test" | "encode">("test");
  const [media, setMedia] = useState<"binary" | "text">("binary");
  const [payload, setPayload] = useState<File | null>(null);
  const [privateKey, setPrivateKey] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
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
  const publishedFile = useRef<File | null>(null);
  const requestRevision = useRef(0);

  useEffect(() => {
    if (!handoff) return;
    if (handoff.stego === publishedFile.current) return;
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

  useEffect(() => { if (vault.privatePem) setPrivateKey(vault.privatePem); }, [vault.privatePem]);

  useEffect(() => {
    if (vault.publicPem && !/\.avi$/i.test(stego?.name ?? "")) setPublicPem(vault.publicPem);
  }, [vault.publicPem, stego?.name]);

  async function run() {
    if (mode === "test" && !stego || mode === "encode" && (!cover || !payload)) return;
    const requestId = ++requestRevision.current;
    // Snapshot before the await, so the staleness comparison is against what was really sent.
    const snapshot = [stego?.name ?? "", cover?.name ?? "", passphrase, publicPem];
    setBusy(true);
    setError("");
    setScenarios(null);
    setResultInputs(null);
    setStaleDismissed(false);
    const form = new FormData();
    form.append("mode", mode);
    if (mode === "test" && stego) form.append("stego", stego, stego.name);
    if (cover) form.append("cover", cover, cover.name);
    if (handoff?.conversion) form.append("conversion_settings", JSON.stringify(handoff.conversion));
    if (mode === "encode" && payload) {form.append("payload", payload); form.append("private_key", privateKey);
      form.append("key_password", keyPassword); form.append("depth", "3");}
    form.append("passphrase", passphrase);
    form.append("public_key", publicPem);
    if (recovery) form.append("recovery", recovery);
    if (recoveryCode) form.append("recovery_code", recoveryCode);
    try {
      await requestJson("/api/v2/session", { method: "POST" });
      const started = await requestJson<Job<{cases: Scenario[]; generated?: {id: string; filename: string}; generated_recovery?: {id: string; filename: string}; recovery_code?: string}>>("/api/v4/jobs/showcase", { method: "POST", body: form });
      if (requestId !== requestRevision.current) return;
      setJobId(started.id);
      for (let attempt = 0; attempt < 1200; attempt++) {
        const state = await requestJson<Job<{cases: Scenario[]; generated?: {id: string; filename: string}; generated_recovery?: {id: string; filename: string}; recovery_code?: string}> & {cases: Scenario[]; total: number}>(`/api/v2/jobs/${encodeURIComponent(started.id)}`);
        if (requestId !== requestRevision.current) return;
        setJobPhase(state.phase); setJobTotal(state.total); setScenarios(state.cases);
        if (state.status === "succeeded") {
          setScenarios(state.result?.cases ?? state.cases);
          if (state.result?.generated) {
            const artifact = state.result.generated;
            const response = await fetch(artifactUrl(artifact.id));
            if (response.ok) {const file = new File([await response.blob()], artifact.filename);
              publishedFile.current = file; setStego(file);
              let recoveryFile: File | undefined;
              if (state.result.generated_recovery) {
                const sidecar = state.result.generated_recovery;
                const sidecarResponse = await fetch(artifactUrl(sidecar.id));
                if (sidecarResponse.ok) recoveryFile = new File([await sidecarResponse.blob()], sidecar.filename);
              }
              if (onHandoff) onHandoff({id: crypto.randomUUID(), stego: file, cover, passphrase, publicPem,
                recovery: recoveryFile, recoveryCode: state.result.recovery_code,
                protocol: isVideo ? "v2-video" : "legacy", serial: Date.now()});
              else onWorkingFile?.(file);
            }
          }
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
  const isVideo = /\.avi$/i.test((mode === "encode" ? cover : stego)?.name ?? "");
  const hasPublicKey = publicPem.trim().length > 0;
  const missing = mode === "encode" ? [!cover && "prepared cover", !payload && "payload", !privateKey && "private key",
    !hasPublicKey && "public key", !isVideo && !passphrase && "passphrase", isVideo && !keyPassword && "key password"].filter(Boolean) as string[] :
    isVideo ? [!stego && "protected AVI", !recovery && "recovery file", !recoveryCode && "recovery code", !hasPublicKey && "Ed25519 public key"].filter(Boolean) as string[] :
    tamperMissing({ hasFile: stego !== null, hasPassphrase: passphrase.length > 0, hasPublicKey });
  const ready = missing.length === 0;

  const applicable = scenarios?.filter((s) => s.verdict !== "Unsupported") ?? [];
  const unsupported = (scenarios?.length ?? 0) - applicable.length;
  const passed = applicable.filter((s) => s.as_expected).length;
  const negatives = applicable.filter((s) => s.expected[0] !== "Authentic").length;
  const rejectedAsExpected = applicable.filter((s) => s.expected[0] !== "Authentic" && s.as_expected).length;
  const saved = scenarios?.filter((s) => s.file !== null).length ?? 0;
  const baseline = scenarios?.find((s) => s.id === POSITIVE_ID);

  // The outcome is the point of the screen, so it takes focus and is announced.
  useEffect(() => {
    if (scenarios) outcomeRef.current?.focus();
  }, [scenarios]);

  if (media === "text") return <TextShowcase back={() => setMedia("binary")} onWorkingFile={onWorkingFile} />;

  return (
    <div className="form-column">
      <button type="button" className="btn ghost sm" onClick={() => setMedia("text")}>Text carrier tests</button>
      <div className="segmented" role="group" aria-label="Showcase mode">
        <button type="button" className={mode === "test" ? "active" : ""} onClick={() => setMode("test")}>Test protected file</button>
        <button type="button" className={mode === "encode" ? "active" : ""} onClick={() => setMode("encode")}>Encode and test</button>
      </div>
      <Panel step="1" title={mode === "test" ? "Choose the protected file" : "Choose a cover and payload"}
        subtitle={mode === "test" ? "Use a file that passes Extract & Verify." : "The app will embed the payload before running the checks."}>
        <ol className="tamper-guide">
          <li><strong>Baseline:</strong> verify the protected file without changes.</li>
          <li><strong>One change:</strong> edit a copy or change a credential for each case.</li>
          <li><strong>Compare:</strong> show expected and observed verdicts; download modified files.</li>
        </ol>
        <div className="columns">
          {mode === "test" && <DropZone label={<>Protected file <span className="req">· required</span></>} id={STEGO_SLOT_ID}
            title="Drop the protected file" hint="picture or WAV produced by Embed & Sign"
            accept={`${STEGO_ACCEPT},.avi,video/x-msvideo`} icon="shield" file={stego}
            onFile={(file) => { requestRevision.current += 1; setStego(file); onWorkingFile?.(file); setScenarios(null); }} />}
          <DropZone label={<>Original cover <span className="opt">{mode === "test" ? "(optional)" : "· required"}</span></>} id={COVER_SLOT_ID}
            title="Drop the original here" hint={mode === "test"
              ? "adds a check that the original contains no hidden payload"
              : "the payload will be embedded into this cover"}
            accept={`${STEGO_ACCEPT},.avi,video/x-msvideo`} icon="image" file={cover}
            onFile={(file) => { setCover(file); setScenarios(null); }} />
          {mode === "encode" && <label>Payload file<input type="file" onChange={(event) => setPayload(event.target.files?.[0] ?? null)} /></label>}
        </div>
      </Panel>

      <Panel step="2" title={mode === "test" ? "Verification inputs" : "Signing and verification inputs"}>
        {!isVideo && <PassphraseField value={passphrase} onChange={setPassphrase}
          hint="The baseline uses this password; the wrong-password case replaces it for that check." />
        }
        {isVideo && mode === "test" && <div className="inline-fields"><label>Recovery file<input type="file" accept=".stegloc" onChange={(e) => setRecovery(e.target.files?.[0] ?? null)} /></label>
          <label>Recovery code<input value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} /></label></div>}
        {mode === "encode" && <div className="inline-fields"><label>Private signing key<textarea value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} /></label>
          <label>Key password<input type="password" value={keyPassword} onChange={(event) => setKeyPassword(event.target.value)} /></label></div>}

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
          <button type="button" className="btn primary lg" disabled={!ready || busy} onClick={run}
            aria-describedby={reasonId} aria-busy={busy}>
            {busy ? <Spinner /> : <Icon name="zap" />} {busy ? "Running the tests…" : mode === "encode" ? "Encode and test" : "Run tamper tests"}
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
              title={`${passed} of ${applicable.length} applicable cases behaved correctly`}
               headingRef={outcomeRef}
               summary={
                 <>
                   Baseline: {baseline?.verdict ?? "not run"}.
                   {negatives > 0 && ` ${rejectedAsExpected} of ${negatives} rejection checks matched their expected verdicts.`}
                   {saved > 0 && ` ${saved} modified file${saved === 1 ? " is" : "s are"} available to download.`}
                   {unsupported > 0 && ` ${unsupported} spatial-LSB cases do not apply to this DCT file.`}
                   {passed < applicable.length && " The rows in red did not behave as expected."}
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
                   <tr><th className="col-test">Test</th><th className="col-result">Expected / observed</th><th className="col-file">Modified file</th></tr>
                </thead>
                <tbody>
                  {scenarios.map((scenario) => (
                    <tr key={scenario.id} className={scenario.as_expected ? "" : "mismatch"}>
                      <td>
                        <strong>{scenario.title}</strong>
                        <p className="attack-what"><b>Change:</b> {scenario.change}</p>
                      </td>
                      <td>
                        <div className="attack-expected"><b>Expected:</b> {expectation(scenario, Boolean(cover))}</div>
                        <div className="attack-observed"><b>Observed:</b>{" "}
                        {scenario.verdict === "Unsupported" ? <span className="chip flat">Unsupported</span> : <VerdictChip verdict={scenario.verdict} />}
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
            {selectedVariant?.file && <Panel title="Selected tampered variant" subtitle="The baseline working file remains unchanged.">
              <p>{selectedVariant.file.filename} · {selectedVariant.file.size.toLocaleString()} bytes</p>
              <p>Expected: {selectedVariant.expected.join(" or ")}. Observed: {selectedVariant.verdict}.</p>
              <a className="btn ghost" href={artifactUrl(selectedVariant.file.id)} download={selectedVariant.file.filename}>Download this variant</a>
            </Panel>}
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
  if (scenario.verdict === "Unsupported") return "Not applicable (spatial LSB only).";
  const alternatives = scenario.expected.join(" or ");
  if (scenario.expected.length > 1) {
    return `${alternatives}. The first failing check determines which verdict appears.`;
  }
  if (!hasCover && NEEDS_ORIGINAL.has(scenario.id)) {
    return `${alternatives} after adding the original cover.`;
  }
  return `${alternatives}.`;
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
