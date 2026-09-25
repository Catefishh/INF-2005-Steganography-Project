import { fileUrl, type HideResponse } from "../../api";
import { Panel } from "../../components";

export function DctResult({ result, onEdit, onHandOff }: {
  result: HideResponse; onEdit: () => void; onHandOff: (page: "verify" | "analyse" | "attacks") => void;
}) {
  const { report, stego } = result;
  return <div className="result-column">
    <Panel title="DCT image protected" subtitle="The signed and encrypted payload is stored in 8×8 RGB transform blocks.">
      <p>{stego.filename} · {stego.size.toLocaleString()} bytes · lossless PNG</p>
      <a className="btn primary" href={fileUrl(stego.id, true)} download={stego.filename}>Download protected PNG</a>
      <div className="btn-row"><button className="btn ghost" onClick={onEdit}>Edit embedding</button>
        <button className="btn ghost" onClick={() => onHandOff("verify")}>Extract &amp; Verify</button>
        <button className="btn ghost" onClick={() => onHandOff("attacks")}>Tamper tests</button></div>
    </Panel>
    <Panel title="Capacity and integrity">
      <p>Encrypted package: {report.package_bytes.toLocaleString()} bytes in {report.span_slots.toLocaleString()} coefficient blocks.
        Capacity: {report.capacity_bytes.toLocaleString()} bytes. Placement: {report.start.text}; header: {report.header.text}.</p>
      <p>Signed record SHA-256: <code className="dct-code">{report.record_sha256}</code></p>
      <p>Payload digest: <code className="dct-code">{report.record.payload.sha256}</code></p>
      <p>Signer fingerprint: <code className="dct-code">{report.signer_fingerprint}</code></p>
      <p>RSA-PSS signature: <code className="dct-code">{report.signature_hex}</code></p>
      <p>Header salt: <code className="dct-code">{report.salt_hex}</code></p>
      <p>Cover protection: {report.coverage?.protected_rgb_values.toLocaleString() ?? 0} RGB values outside occupied blocks and {report.coverage?.alpha_values.toLocaleString() ?? 0} alpha values.
        Pixels inside embedding blocks can change without failing the cover hash if their encoded bits remain intact.</p>
      {report.coverage?.protected_rgb_values === 0 && <p>No RGB cover-integrity coverage is available for this placement.</p>}
      <p>Lossless PNG prevents further codec loss. Resizing, JPEG recompression and editing may destroy recovery.</p>
      <details><summary>Full signed record</summary><pre className="raw-json">{JSON.stringify(report.record, null, 2)}</pre></details>
    </Panel>
  </div>;
}
