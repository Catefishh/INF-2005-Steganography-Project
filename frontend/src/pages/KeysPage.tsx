import { useState } from "react";
import { api } from "../api";
import { DropZone, ErrorNote, Icon, Panel, Spinner } from "../components";
import { downloadText, errorText, shortHash, type Vault } from "../util";

export function KeysPage({ vault, setVault }: { vault: Vault; setVault: (vault: Vault) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [privateFile, setPrivateFile] = useState<File | null>(null);
  const [publicFile, setPublicFile] = useState<File | null>(null);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const keys = await api.generateKeys();
      setVault({ privatePem: keys.private_key, publicPem: keys.public_key, privateFingerprint: keys.fingerprint,
        publicFingerprint: keys.fingerprint, bits: keys.bits });
      setPrivateFile(null);
      setPublicFile(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function load(file: File | null, kind: "private" | "public") {
    if (kind === "private") setPrivateFile(file);
    else setPublicFile(file);
    if (!file) return;
    setError("");
    try {
      const pem = await file.text();
      const info = await api.inspectKey(pem);
      if (info.type !== kind) {
        setError(kind === "public"
          ? "That file is a PRIVATE key. The receiver only ever needs the sender's public key."
          : "That file is a public key. Signing needs the matching private key.");
        return;
      }
      if (kind === "private") {
        setVault({ ...vault, privatePem: pem, privateFingerprint: info.fingerprint, bits: info.bits ?? vault.bits });
      } else {
        setVault({ ...vault, publicPem: pem, publicFingerprint: info.fingerprint, bits: vault.bits ?? info.bits });
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  const pairMatches = vault.privateFingerprint !== null && vault.privateFingerprint === vault.publicFingerprint;

  return (
    <div className="page-grid">
      <Panel step="A" title="How the digital signature works"
        subtitle="Hash, then sign with the private key; recompute the hash, then verify with the public key (FR4).">
        <div className="flow">
          <div className="flow-card sender">
            <span className="flow-tag">Sender A (keeps private key)</span>
            <ol>
              <li>Build the verification record (media ID, timestamp, nonce, hashes)</li>
              <li><b>digest = SHA-256(record)</b></li>
              <li><b>signature = RSA-sign(private key, digest)</b></li>
              <li>Encrypt and hide record + signature with LSB replacement</li>
            </ol>
          </div>
          <div className="flow-arrow"><Icon name="send" size={22} /><span>stego file</span></div>
          <div className="flow-card receiver">
            <span className="flow-tag">Receiver B (has public key)</span>
            <ol>
              <li>Extract and decrypt record + signature</li>
              <li><b>digest = SHA-256(record)</b> (recomputed)</li>
              <li><b>RSA-verify(public key, digest, signature)</b></li>
              <li>Compare the signed payload and cover hashes</li>
            </ol>
          </div>
        </div>
        <p className="muted small">A hash cannot be reversed. Only the private key can create a signature that the public key accepts.</p>
      </Panel>

      <Panel step="B" title="Generate an RSA-2048 key pair" subtitle="Keys stay in this browser tab until you download them."
        aside={<button type="button" className="btn primary" onClick={generate} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="key" />} Generate key pair
        </button>}>
        <ErrorNote text={error} />
        <div className="key-grid">
          <div className={`key-card ${vault.privatePem ? "ready" : ""}`}>
            <div className="key-card-head">
              <Icon name="lock" /> <strong>Private key</strong> <span className="chip bad">keep secret</span>
            </div>
            <p className="mono small">{vault.privatePem ? `fingerprint ${shortHash(vault.privateFingerprint, 32)}` : "No private key loaded"}</p>
            <DropZone title="Load private.pem" hint="Drop the sender's private key file" accept=".pem,.key,.txt"
              icon="key" file={privateFile} onFile={(file) => void load(file, "private")} />
            <button type="button" className="btn ghost" disabled={!vault.privatePem}
              onClick={() => downloadText("private_key.pem", vault.privatePem)}>
              <Icon name="download" /> Download private_key.pem
            </button>
          </div>
          <div className={`key-card ${vault.publicPem ? "ready" : ""}`}>
            <div className="key-card-head">
              <Icon name="eye" /> <strong>Public key</strong> <span className="chip good">share freely</span>
            </div>
            <p className="mono small">{vault.publicPem ? `fingerprint ${shortHash(vault.publicFingerprint, 32)}` : "No public key loaded"}</p>
            <DropZone title="Load public.pem" hint="Drop the sender's public key file" accept=".pem,.pub,.txt"
              icon="key" file={publicFile} onFile={(file) => void load(file, "public")} />
            <button type="button" className="btn ghost" disabled={!vault.publicPem}
              onClick={() => downloadText("public_key.pem", vault.publicPem)}>
              <Icon name="download" /> Download public_key.pem
            </button>
          </div>
        </div>
        {vault.privatePem && vault.publicPem && (
          <div className={`note ${pairMatches ? "note-good" : "note-warn"}`}>
            <Icon name={pairMatches ? "check" : "alert"} />
            <span>{pairMatches
              ? `The public key matches the private key (${vault.bits ?? "?"}-bit RSA).`
              : "These two keys are not a pair (or the private key is password-protected). Signatures made with this private key will not verify with this public key."}</span>
          </div>
        )}
      </Panel>
    </div>
  );
}
