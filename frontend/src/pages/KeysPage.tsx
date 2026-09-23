import { useRef, useState } from "react";
import { api } from "../api";
import {
  ActionBar, ConfirmDialog, Disclosure, DropZone, EmptyState, ErrorNote, Icon, Panel, Spinner,
} from "../components";
import { downloadText, errorText, shortHash, type Page, type Vault } from "../util";

export function KeysPage({ vault, setVault, goTo }: {
  vault: Vault;
  setVault: (vault: Vault) => void;
  goTo: (page: Page) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [privateFile, setPrivateFile] = useState<File | null>(null);
  const [publicFile, setPublicFile] = useState<File | null>(null);
  const [saved, setSaved] = useState({ privateKey: false, publicKey: false });
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const replaceButton = useRef<HTMLButtonElement>(null);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const keys = await api.generateKeys();
      setVault({ privatePem: keys.private_key, publicPem: keys.public_key, privateFingerprint: keys.fingerprint,
        publicFingerprint: keys.fingerprint, bits: keys.bits });
      setPrivateFile(null);
      setPublicFile(null);
      setSaved({ privateKey: false, publicKey: false });
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
        // A key loaded from disk already exists as a file, so there is nothing to lose.
        setSaved((current) => ({ ...current, privateKey: true }));
      } else {
        setVault({ ...vault, publicPem: pem, publicFingerprint: info.fingerprint, bits: vault.bits ?? info.bits });
        setSaved((current) => ({ ...current, publicKey: true }));
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  function savePrivate() {
    downloadText("private_key.pem", vault.privatePem);
    setSaved((current) => ({ ...current, privateKey: true }));
  }

  function savePublic() {
    downloadText("public_key.pem", vault.publicPem);
    setSaved((current) => ({ ...current, publicKey: true }));
  }

  const hasPrivate = Boolean(vault.privatePem);
  const hasPublic = Boolean(vault.publicPem);
  const hasAny = hasPrivate || hasPublic;
  const hasBoth = hasPrivate && hasPublic;
  const pairMatches = vault.privateFingerprint !== null && vault.privateFingerprint === vault.publicFingerprint;
  const unsaved = (hasPrivate && !saved.privateKey) || (hasPublic && !saved.publicKey);
  const privateUnsaved = hasPrivate && !saved.privateKey;

  return (
    <div className="form-column">
      {hasAny ? (
        <>
          {hasBoth && pairMatches ? (
            <div className="note note-good">
              <Icon name="check" />
              <span>
                <b>Key pair ready — RSA-{vault.bits ?? "?"}, and the two keys match.</b>
                Fingerprint <span className="fingerprint">{shortHash(vault.privateFingerprint, 32)}</span>
              </span>
            </div>
          ) : hasBoth ? (
            <div className="note note-warn">
              <Icon name="alert" />
              <span>
                <b>These two keys are not a pair.</b>
                The private key may also be password-protected. Signatures made with this private key will not verify
                with this public key.
                <span className="fingerprint" style={{ display: "block", marginTop: 6 }}>
                  private {shortHash(vault.privateFingerprint, 32)}
                </span>
                <span className="fingerprint" style={{ display: "block" }}>
                  public&nbsp; {shortHash(vault.publicFingerprint, 32)}
                </span>
              </span>
            </div>
          ) : (
            <div className="note note-warn">
              <Icon name="alert" />
              <span>
                <b>Only the {hasPrivate ? "private" : "public"} key is loaded.</b>
                {hasPrivate
                  ? " You can embed and sign, but you cannot verify until the matching public key is loaded."
                  : " You can verify, but you cannot embed and sign until the matching private key is loaded."}
                <span className="fingerprint" style={{ display: "block", marginTop: 6 }}>
                  {shortHash(hasPrivate ? vault.privateFingerprint : vault.publicFingerprint, 32)}
                </span>
              </span>
            </div>
          )}

          {unsaved && (
            <div className="note note-warn">
              <Icon name="alert" />
              <span>
                <b>Not saved yet.</b>
                {hasBoth
                  ? " These keys only exist in this browser tab. Refreshing or closing the tab loses them, and files you already protected could no longer be verified."
                  : " This key only exists in this browser tab. Refreshing or closing the tab loses it."}
                <span className="note-actions">
                  {hasBoth && (
                    <button type="button" className="btn primary sm" onClick={() => { savePrivate(); savePublic(); }}>
                      <Icon name="download" size={14} /> Save both keys
                    </button>
                  )}
                  {privateUnsaved && (
                    <button type="button" className={`btn ${hasBoth ? "ghost" : "primary"} sm`} onClick={savePrivate}>
                      <Icon name="download" size={14} /> Save private key only
                    </button>
                  )}
                  {hasPublic && !saved.publicKey && (
                    <button type="button" className={`btn ${hasBoth || privateUnsaved ? "ghost" : "primary"} sm`} onClick={savePublic}>
                      <Icon name="download" size={14} /> Save public key only
                    </button>
                  )}
                </span>
              </span>
            </div>
          )}

          <Panel title="Your key pair">
            <div className="key-rows">
              <div className="key-row">
                <span className="role"><Icon name="lock" size={16} /> Private key</span>
                <span className="chip bad">keep secret</span>
                <span className="about">You sign with this. Never send it to anyone.</span>
                <span className="acts">
                  <button type="button" className="btn ghost sm" disabled={!hasPrivate} onClick={savePrivate}>
                    <Icon name="download" size={14} /> private_key.pem
                  </button>
                  <button type="button" className="btn quiet sm" onClick={() => setLoadOpen(true)}>Replace…</button>
                </span>
              </div>
              <div className="key-row">
                <span className="role"><Icon name="eye" size={16} /> Public key</span>
                <span className="chip good">share freely</span>
                <span className="about">Give this to whoever needs to verify your files.</span>
                <span className="acts">
                  <button type="button" className="btn ghost sm" disabled={!hasPublic} onClick={savePublic}>
                    <Icon name="download" size={14} /> public_key.pem
                  </button>
                  <button type="button" className="btn quiet sm" onClick={() => setLoadOpen(true)}>Replace…</button>
                </span>
              </div>
            </div>
          </Panel>
        </>
      ) : (
        <Panel title="Generate an RSA-2048 key pair">
          <EmptyState icon="key" title="No key pair yet">
            <p>
              Generate an RSA-2048 pair. The private key signs the files you embed into; the public key
              lets the receiver verify them.
            </p>
          </EmptyState>
        </Panel>
      )}

      <ErrorNote text={error} />

      {hasAny ? (
        <ActionBar heading="Next: embed and sign a file" detail="Your private key is filled in for you there.">
          {(reasonId) => (
            <>
              <button type="button" className="btn quiet" ref={replaceButton} onClick={() => setConfirmReplace(true)}
                disabled={busy} aria-describedby={reasonId}>
                {busy ? <Spinner /> : <Icon name="refresh" />} Replace key pair
              </button>
              <button type="button" className="btn primary lg" onClick={() => goTo("hide")}>
                Go to Embed &amp; Sign <Icon name="arrowRight" size={16} />
              </button>
            </>
          )}
        </ActionBar>
      ) : (
        <ActionBar heading="Generating creates both keys at once"
          detail="Takes about a second. You can download them afterwards.">
          {(reasonId) => (
            <button type="button" className="btn primary lg" onClick={generate} disabled={busy}
              aria-describedby={reasonId}>
              {busy ? <Spinner /> : <Icon name="key" />} Generate key pair
            </button>
          )}
        </ActionBar>
      )}

      <Disclosure title="Already have a key pair? Load .pem files instead" value="private + public"
        open={loadOpen} onOpenChange={setLoadOpen}>
        <div className="key-grid">
          <DropZone label="Private key file" title="Load private.pem" hint="Drop the sender's private key file"
            accept=".pem,.key,.txt" icon="key" file={privateFile} onFile={(file) => void load(file, "private")} />
          <DropZone label="Public key file" title="Load public.pem" hint="Drop the sender's public key file"
            accept=".pem,.pub,.txt" icon="key" file={publicFile} onFile={(file) => void load(file, "public")} />
        </div>
      </Disclosure>

      <Disclosure title="How signing works" value="for the write-up">
        <div className="flow">
          <div className="flow-card sender">
            <span className="flow-tag">Sender A (keeps private key)</span>
            <ol>
              <li>Build the signed record (media ID, timestamp, nonce, hashes)</li>
              <li><b>digest = SHA-256(record)</b></li>
              <li><b>signature = RSA-sign(private key, digest)</b></li>
              <li>Encrypt and hide record + signature with LSB replacement</li>
            </ol>
          </div>
          <div className="flow-arrow"><Icon name="send" size={22} /><span>protected file</span></div>
          <div className="flow-card receiver">
            <span className="flow-tag">Receiver B (has public key)</span>
            <ol>
              <li>Extract and decrypt record + signature</li>
              <li><b>digest = SHA-256(record)</b> (recomputed)</li>
              <li><b>RSA-verify(public key, digest, signature)</b></li>
              <li>Compare the hidden content and cover hashes</li>
            </ol>
          </div>
        </div>
        <p className="muted small">A hash cannot be reversed. Only the private key can create a signature that the public key accepts.</p>
      </Disclosure>

      {confirmReplace && (
        <ConfirmDialog title="Replace this key pair?" confirmLabel="Replace anyway" cancelLabel="Keep the current pair"
          danger onCancel={() => setConfirmReplace(false)}
          onConfirm={() => { setConfirmReplace(false); void generate(); }}>
          <p>
            The current pair (<span className="fingerprint">{shortHash(vault.privateFingerprint ?? vault.publicFingerprint, 16)}</span>)
            will be discarded and cannot be recovered.
          </p>
          <div className="note note-warn">
            <Icon name="alert" />
            <span>
              <b>Files you already protected in this session will stop passing the check.</b>
              They were signed with the old private key, and Extract &amp; Verify will start using the new public key.
            </span>
          </div>
          {privateUnsaved && (
            <div className="note note-info">
              <Icon name="download" />
              <span>
                You have not saved the current private key yet.{" "}
                <button type="button" className="link-btn" onClick={savePrivate}>Save it first</button>
              </span>
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
