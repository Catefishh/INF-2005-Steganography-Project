import { useEffect, useState } from "react";
import { api, fileUrl, type CoverInfo, type SignedRecord, type VerifyResponse } from "../api";
import {
  DropZone, ErrorNote, Icon, KeyField, MediaPreview, Panel, PassphraseField, Spinner, VerdictBanner, VerifySteps,
} from "../components";
import { errorText, formatBytes, type Handoff, type Vault } from "../util";

export function VerifyPage({ vault, handoff }: { vault: Vault; handoff: Handoff | null }) {
  const [stego, setStego] = useState<File | null>(null);
  const [info, setInfo] = useState<CoverInfo | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [publicPem, setPublicPem] = useState("");
  const [override, setOverride] = useState(false);
  const [overrideX, setOverrideX] = useState("0");
  const [overrideY, setOverrideY] = useState("0");
  const [overrideSeconds, setOverrideSeconds] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VerifyResponse | null>(null);

  useEffect(() => {
    if (handoff) {
      setStego(handoff.stego);
      setResult(null);
    }
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

  async function submit() {
    if (!stego) return;
    setBusy(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("stego", stego, stego.name);
    form.append("passphrase", passphrase);
    form.append("public_key", publicPem);
    if (override) {
      if (info?.kind === "audio") {
        form.append("start_seconds", overrideSeconds);
      } else {
        form.append("start_x", overrideX);
        form.append("start_y", overrideY);
      }
    }
    try {
      setResult(await api.verify(form));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-grid">
      <div className="columns">
        <div className="column">
          <Panel step="1" title="Received stego file" subtitle="The file party A sent (e.g. downloaded from email). Drag it in.">
            <DropZone title="Drop the stego image or WAV" hint="or click to browse" accept="image/*,.png,.bmp,.wav,audio/wav"
              icon="upload" file={stego} onFile={(file) => { setStego(file); setResult(null); }} />
            {info && (
              <div className="facts">
                <span><b>{info.kind === "image" ? `${info.width} × ${info.height}` : `${info.duration?.toFixed(2)} s`}</b>{info.kind}</span>
                <span><b>{info.n_slots.toLocaleString()}</b>slots</span>
                <span><b>{formatBytes(info.file_size ?? 0)}</b>size</span>
              </div>
            )}
          </Panel>
        </div>
        <div className="column">
          <Panel step="2" title="Verification secrets" subtitle="Passphrase shared in person + the sender's public key.">
            <PassphraseField value={passphrase} onChange={setPassphrase} />
            <KeyField label="Sender's RSA public key" value={publicPem} onChange={setPublicPem}
              placeholder="-----BEGIN PUBLIC KEY----- (drop public_key.pem here)" vaultPem={vault.publicPem} vaultLabel="Use key from Keys page" />
            <details className="advanced" open={override} onToggle={(event) => setOverride((event.target as HTMLDetailsElement).open)}>
              <summary><Icon name="target" size={14} /> Manual start location (demonstrate a wrong start)</summary>
              {info?.kind === "audio" ? (
                <div className="inline-fields">
                  <label>Time (s)<input type="number" min={0} step="0.001" value={overrideSeconds} onChange={(event) => setOverrideSeconds(event.target.value)} /></label>
                </div>
              ) : (
                <div className="inline-fields">
                  <label>X<input type="number" min={0} value={overrideX} onChange={(event) => setOverrideX(event.target.value)} /></label>
                  <label>Y<input type="number" min={0} value={overrideY} onChange={(event) => setOverrideY(event.target.value)} /></label>
                </div>
              )}
              <small className="field-hint">While open, the payload is read from this location instead of the start stored in the encrypted header.</small>
            </details>
            <ErrorNote text={error} />
            <button type="button" className="btn primary wide" disabled={!stego || busy || !passphrase || !publicPem.trim()} onClick={submit}>
              {busy ? <Spinner /> : <Icon name="shield" />} {busy ? "Extracting and verifying…" : "Extract & verify"}
            </button>
          </Panel>
        </div>
      </div>

      {result && (
        <Panel className="result" step="✓" title="Verification result">
          <VerdictBanner verdict={result.verdict} summary={result.summary} />
          <div className="columns">
            <div className="column">
              <h4 className="sub-title">Verification pipeline</h4>
              <VerifySteps steps={result.steps} />
            </div>
            <div className="column">
              {result.content && result.record && (
                <>
                  <h4 className="sub-title">Extracted payload</h4>
                  <div className="extracted">
                    <MediaPreview url={fileUrl(result.content.id)} mime={result.content.media_type} name={result.content.filename}
                      text={result.content.text} />
                    {result.content.text_truncated && <small className="field-hint">Preview truncated.</small>}
                    <a className="btn ghost" href={fileUrl(result.content.id, true)} download={result.content.filename}>
                      <Icon name="download" /> Download {result.content.filename} ({formatBytes(result.content.size)})
                    </a>
                  </div>
                </>
              )}
              {result.record && <RecordTable record={result.record} trusted={result.record_trusted} />}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

function RecordTable({ record, trusted }: { record: SignedRecord; trusted: boolean }) {
  const rows: [string, string][] = [
    ["Media ID", record.media_id],
    ["Timestamp (UTC)", record.timestamp],
    ["Nonce", record.nonce],
    ["Team", record.team || "-"],
    ["Signer fingerprint", record.signer_fingerprint],
    ["Cover", `${record.cover?.filename} (${record.cover?.descriptor})`],
    ["Cover SHA-256", record.cover?.sha256],
    ["Payload", `${record.payload?.filename} · ${record.payload?.media_type} · ${record.payload?.size} B`],
    ["Payload SHA-256", record.payload?.sha256],
    ["Embedding", `${record.embedding?.method}, ${record.embedding?.lsb_bits} LSB(s), start slot ${Number(record.embedding?.start_slot)}`],
  ];
  return (
    <>
      <h4 className="sub-title">
        Verification record {trusted ? <span className="chip good">signature verified</span> : <span className="chip bad">untrusted</span>}
      </h4>
      <div className="table-wrap">
        <table className="kv">
          <tbody>
            {rows.map(([key, value]) => (
              <tr key={key}><th>{key}</th><td className="mono">{String(value)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
