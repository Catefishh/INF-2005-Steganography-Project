import { CarrierForm } from "./text/CarrierForm";
import { ProtectedSummary, VerificationSummary } from "./text/Results";
import { useRef, useState } from "react";
import { Panel, ErrorNote } from "../components";
import { downloadText, errorText } from "../util";

import { artifactUrl, requestJson as request, runTextJob as runJob } from "../api/jobs";
import { generatedText, recoveryFile, type Stored, type Protected, type Verified } from "../api/text";

export function TextPage() {
  const sessionReady = useRef(false);
  const [method, setMethod] = useState("acrostic");
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState("");
  const [carrier, setCarrier] = useState("");
  const [recovery, setRecovery] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [password, setPassword] = useState("");
  const [protectedResult, setProtected] = useState<Protected | null>(null);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [estimate, setEstimate] = useState<{ frame_bytes: number; required_lines_or_symbols: number } | null>(null);
  const [generatedInitials, setGeneratedInitials] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function session() {
    if (sessionReady.current) return;
    await request("/api/v2/session", { method: "POST" });
    sessionReady.current = true;
  }
  async function keys() {
    setError("");
    try {
      const form = new FormData(); form.append("password", password);
      const pair = await request<{ private_key: string; public_key: string }>("/api/v2/keys/generate", { method: "POST", body: form });
      setPrivateKey(pair.private_key); setPublicKey(pair.public_key);
    } catch (cause) { setError(errorText(cause)); }
  }
  async function previewCapacity() {
    setError("");
    try {
      const form = new FormData(); form.append("message", message); form.append("method", method); form.append("visible", visible);
      setEstimate(await request("/api/v3/text/estimate", { method: "POST", body: form }));
    } catch (cause) { setError(errorText(cause)); }
  }
  async function protect() {
    setError(""); setStatus("Preparing text carrier"); setProtected(null); setVerified(null);
    try {
      await session();
      const form = new FormData();
      for (const [name, value] of Object.entries({ message, method, visible, private_key: privateKey, key_password: password })) form.append(name, value);
      const result = await runJob<Protected>("/api/v3/jobs/text/protect", form, setStatus);
      setProtected(result); setCode(result.recovery_code);
      const produced = await generatedText(result.carrier.id);
      setCarrier(produced);
      setGeneratedInitials(method === "acrostic" ? produced.split("\n").map((line) => line[0] || "").join("") : "");
      const sidecar = await recoveryFile(result.recovery);
      if (sidecar) setRecovery(sidecar);
    } catch (cause) { setError(errorText(cause)); }
    finally { setStatus(""); }
  }
  async function verify() {
    if (!recovery) return;
    setError(""); setStatus("Verifying hidden text"); setVerified(null);
    try {
      await session();
      const form = new FormData();
      form.append("carrier", new File([carrier], "carrier.txt", { type: "text/plain" }));
      form.append("recovery", recovery);
      form.append("recovery_code", code); form.append("public_key", publicKey);
      setVerified(await runJob<Verified>("/api/v3/jobs/text/verify", form, setStatus));
    } catch (cause) { setError(errorText(cause)); }
    finally { setStatus(""); }
  }
  async function importText(file: File | undefined, receive: (value: string) => void) {
    if (!file) return;
    try { receive(await file.text()); } catch (cause) { setError(errorText(cause)); }
  }
  const diagnostic = method === "zero-width"
    ? `U+200B: ${[...carrier].filter((c) => c === "\u200b").length}; U+200C: ${[...carrier].filter((c) => c === "\u200c").length}`
    : method === "whitespace" ? `Space endings: ${carrier.split("\n").filter((line) => line.endsWith(" ")).length}; tab endings: ${carrier.split("\n").filter((line) => line.endsWith("\t")).length}`
      : `Required line initials: ${protectedResult?.required_lines_or_symbols ?? 0}`;
  const acrosticValid = method !== "acrostic" || !generatedInitials
    || carrier.split("\n").map((line) => line[0] || "").join("") === generatedInitials;

  return <div className="form-column">
    <CarrierForm method={method} onMethod={(value) => { setMethod(value); setEstimate(null); }}
      message={message} onMessage={setMessage} visible={visible} onVisible={setVisible}
      onImport={(file) => void importText(file, setVisible)} onEstimate={() => void previewCapacity()} estimate={estimate} />
    <Panel title="Sender keys and protection">
      <div className="field"><label htmlFor="text-password">Key password</label><input id="text-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <button type="button" className="btn ghost" disabled={!password} onClick={() => void keys()}>Generate Ed25519 keys</button>
      {!password && <p className="field-hint">Enter a password to encrypt a generated private key.</p>}
      <div className="field"><label htmlFor="text-private">Encrypted private key PEM</label><textarea id="text-private" value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} /></div>
      <div className="field"><label htmlFor="text-public">Public key PEM</label><textarea id="text-public" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} /></div>
      <div className="btn-row"><button type="button" className="btn ghost" disabled={!privateKey} onClick={() => downloadText("text_private_key.pem", privateKey)}>Save private key</button>
        <button type="button" className="btn ghost" disabled={!publicKey} onClick={() => downloadText("text_public_key.pem", publicKey)}>Save public key</button></div>
      <button type="button" className="btn primary" disabled={!privateKey || Boolean(status)} onClick={() => void protect()}>Encrypt, sign and hide</button>
      {protectedResult && <ProtectedSummary result={protectedResult} />}
    </Panel>
    <Panel title="Carrier and recipient verification" subtitle="Acrostic sentences can be rewritten while their first letters and line order stay the same.">
      <div className="field"><label htmlFor="text-carrier">Carrier text</label><textarea id="text-carrier" rows={10} value={carrier} onChange={(event) => setCarrier(event.target.value)} /></div>
      <input type="file" accept=".txt,text/plain" aria-label="Import carrier text" onChange={(event) => void importText(event.target.files?.[0], setCarrier)} />
      {!acrosticValid && <p className="note note-warn">The acrostic line count or initials changed. Restore them before export.</p>}
      <button type="button" className="btn ghost" disabled={!carrier || !acrosticValid} onClick={() => downloadText("stegloc-text-edited.txt", carrier)}>Save edited carrier</button>
      {carrier && <p className="field-hint">Diagnostic: {diagnostic}. Hidden message and sender are authenticated; visible wording is not.</p>}
      <div className="field"><label htmlFor="text-recovery">Recovery material</label><input id="text-recovery" type="file" accept=".stegloc-text" onChange={(event) => setRecovery(event.target.files?.[0] ?? null)} /></div>
      <div className="field"><label htmlFor="text-code">Recovery code</label><input id="text-code" value={code} onChange={(event) => setCode(event.target.value)} /></div>
      <button type="button" className="btn primary" disabled={!carrier || !recovery || !code || !publicKey || Boolean(status)} onClick={() => void verify()}>Extract and verify</button>
      {verified && <VerificationSummary result={verified} />}
    </Panel>
    {status && <p role="status">{status}</p>}<ErrorNote text={error} />
  </div>;
}
