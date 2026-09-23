import { Panel } from "../../components";
import { downloadText } from "../../util";

/** Key entry and fingerprint controls for the V2 sender and recipient. */
export function KeysForm({ password, onPassword, privatePem, onPrivatePem, publicPem, onPublicPem,
  fingerprint, onGenerate, onInspect }: {
  password: string; onPassword: (value: string) => void;
  privatePem: string; onPrivatePem: (value: string) => void;
  publicPem: string; onPublicPem: (value: string) => void;
  fingerprint: string; onGenerate: () => void; onInspect: () => void;
}) {
  return <Panel title="Ed25519 keys" subtitle="The private key signs. Share only the public key and its fingerprint with the recipient.">
    <div className="columns">
      <div className="field"><label htmlFor="v2-key-password">Private-key password for export or import</label>
        <input id="v2-key-password" type="password" value={password} onChange={(event) => onPassword(event.target.value)} /></div>
      <div className="field"><label htmlFor="v2-private">Private PEM</label>
        <textarea id="v2-private" value={privatePem} onChange={(event) => onPrivatePem(event.target.value)} rows={4} />
        <input aria-label="Load Ed25519 private key" type="file" accept=".pem" onChange={(event) => void event.target.files?.[0]?.text().then(onPrivatePem)} /></div>
      <div className="field"><label htmlFor="v2-public">Public PEM</label>
        <textarea id="v2-public" value={publicPem} onChange={(event) => onPublicPem(event.target.value)} rows={4} />
        <input aria-label="Load Ed25519 public key" type="file" accept=".pem" onChange={(event) => void event.target.files?.[0]?.text().then(onPublicPem)} /></div>
    </div>
    <div className="btn-row">
      <button type="button" className="btn primary" disabled={!password} onClick={onGenerate}>Generate Ed25519 keys</button>
      <button type="button" className="btn ghost" disabled={!publicPem} onClick={onInspect}>Show public-key fingerprint</button>
      {privatePem && <button type="button" className="btn ghost" onClick={() => downloadText("v2_private.pem", privatePem)}>Save private key</button>}
      {publicPem && <button type="button" className="btn ghost" onClick={() => downloadText("v2_public.pem", publicPem)}>Save public key</button>}
    </div>
    {fingerprint && <p className="field-hint">Public-key SHA-256 fingerprint: <span className="fingerprint">{fingerprint}</span></p>}
  </Panel>;
}
