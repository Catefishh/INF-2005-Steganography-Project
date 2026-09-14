import { useEffect, useState } from "react";
import { api, fileUrl, type Scenario } from "../api";
import { DropZone, ErrorNote, Icon, KeyField, Panel, PassphraseField, Spinner, Stat, VerdictChip } from "../components";
import { errorText, type Handoff, type Vault } from "../util";

export function AttackPage({ vault, handoff }: { vault: Vault; handoff: Handoff | null }) {
  const [stego, setStego] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [publicPem, setPublicPem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);

  useEffect(() => {
    if (handoff) {
      setStego(handoff.stego);
      setCover(handoff.cover);
      setPassphrase(handoff.passphrase);
      if (handoff.publicPem) setPublicPem(handoff.publicPem);
      setScenarios(null);
    }
  }, [handoff]);

  useEffect(() => {
    if (vault.publicPem) setPublicPem(vault.publicPem);
  }, [vault.publicPem]);

  async function run() {
    if (!stego) return;
    setBusy(true);
    setError("");
    setScenarios(null);
    const form = new FormData();
    form.append("stego", stego, stego.name);
    if (cover) form.append("cover", cover, cover.name);
    form.append("passphrase", passphrase);
    form.append("public_key", publicPem);
    try {
      setScenarios((await api.attacks(form)).scenarios);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const passed = scenarios?.filter((s) => s.as_expected).length ?? 0;
  const negatives = scenarios?.filter((s) => s.expected[0] !== "Authentic").length ?? 0;

  return (
    <div className="page-grid">
      <Panel step="1" title="Attack simulation" subtitle="Starts from an authentic stego file, applies one attack at a time and runs the normal verifier on each result."
        aside={<button type="button" className="btn primary" disabled={!stego || !passphrase || !publicPem.trim() || busy} onClick={run}>
          {busy ? <Spinner /> : <Icon name="zap" />} {busy ? "Running attacks…" : "Run attack suite"}
        </button>}>
        <div className="columns">
          <div className="column">
            <DropZone title="Authentic stego file" hint="image or WAV produced by Embed & sign" accept="image/*,.wav" icon="shield"
              file={stego} onFile={setStego} />
            <DropZone title="Original cover (optional)" hint="adds the Payload Missing case" accept="image/*,.wav" icon="image"
              file={cover} onFile={setCover} />
          </div>
          <div className="column">
            <PassphraseField value={passphrase} onChange={setPassphrase} />
            <KeyField label="Sender's RSA public key" value={publicPem} onChange={setPublicPem}
              placeholder="-----BEGIN PUBLIC KEY-----" vaultPem={vault.publicPem} vaultLabel="Use key from Keys page" />
          </div>
        </div>
        <ErrorNote text={error} />
      </Panel>

      {scenarios && (
        <Panel className="result" step="2" title="Results" subtitle="Tampered files can be downloaded as sample evidence for the submission.">
          <div className="stats">
            <Stat label="Behaved as expected" value={`${passed} / ${scenarios.length}`} tone={passed === scenarios.length ? "good" : "bad"} />
            <Stat label="Negative cases" value={negatives} />
            <Stat label="Positive cases" value={scenarios.length - negatives} />
          </div>
          <div className="table-wrap">
            <table className="attacks">
              <thead>
                <tr><th>Scenario</th><th>What was changed</th><th>Expected</th><th>Verdict</th><th>Reason given by verifier</th><th>Sample</th></tr>
              </thead>
              <tbody>
                {scenarios.map((scenario) => (
                  <tr key={scenario.id} className={scenario.as_expected ? "" : "mismatch"}>
                    <td><strong>{scenario.title}</strong></td>
                    <td>{scenario.change}</td>
                    <td>{scenario.expected.join(" / ")}</td>
                    <td><VerdictChip verdict={scenario.verdict} /> {scenario.as_expected ? <Icon name="check" size={14} /> : <Icon name="x" size={14} />}</td>
                    <td className="small">{scenario.summary}</td>
                    <td>{scenario.file ? (
                      <a className="link-btn" href={fileUrl(scenario.file.id, true)} download={scenario.file.filename}>
                        <Icon name="download" size={14} /> {scenario.file.filename}
                      </a>
                    ) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
