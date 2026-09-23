import { MediaPreview, Panel } from "../../components";
import { artifactUrl } from "../../api/jobs";
import type { ProtectResult, Stored, VerifyResult } from "../../api/v2";
import { formatBytes } from "../../util";

function artifact(file: Stored) {
  return <a className="btn ghost" href={artifactUrl(file.id)} download={file.filename}>
    Download {file.filename} ({formatBytes(file.size)})</a>;
}

export function ProtectedSummary({ result, onUse }: { result: ProtectResult; onUse: () => void }) {
  return <div className="note note-good"><span>
    <b>Protected {result.media_kind} ready.</b> Save the carrier and recovery file. Send the code separately.
    <span className="note-actions">{artifact(result.carrier)}{artifact(result.recovery)}</span>
    <label className="field" htmlFor="v2-generated-code">Recovery code</label>
    <input id="v2-generated-code" readOnly value={result.recovery_code} />
    <button type="button" className="btn ghost" onClick={onUse}>Use generated files below</button>
  </span></div>;
}

export function VerificationSummary({ result, preview }: {
  result: VerifyResult; preview: { url: string; text?: string } | null;
}) {
  return <>
    <div className={`note ${result.verdict === "Authentic" ? "note-good" : "note-warn"}`}><span>
      <b>Verdict: {result.verdict}</b>
      {result.content && <span className="note-actions">{artifact(result.content)}</span>}
      <details><summary>Verification stages</summary><ul>
        {Object.entries(result.stages).map(([name, stage]) =>
          <li key={name}>{name}: {stage.status} {stage.evidence || stage.reason}</li>)}
      </ul></details>
    </span></div>
    {result.content && preview && <Panel title="Verified content preview">
      <MediaPreview url={preview.url} mime={result.content.media_type || "application/octet-stream"}
        name={result.content.filename} text={preview.text} />
    </Panel>}
  </>;
}
