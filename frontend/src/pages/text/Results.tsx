import { artifactUrl } from "../../api/jobs";
import type { Protected, Stored, Verified } from "../../api/text";
import { HashEvidence } from "../../ui/hashEvidence";

function link(file: Stored) {
  return <a className="btn ghost" href={artifactUrl(file.id)} download={file.filename}>Download {file.filename}</a>;
}

export function ProtectedSummary({ result }: { result: Protected }) {
  return <>{result.record?.message_sha256 && <HashEvidence evidence={{algorithm: "SHA-256", scope: "UTF-8 message bytes before encoding", expected: result.record.message_sha256,
    computed: result.record.message_sha256, status: "match", expected_trusted: false}} />}
    <div className="note note-good"><span>Encrypted frame: {result.frame_bytes.toLocaleString()} bytes. Save the carrier and recovery material; send the code separately.<span className="note-actions">{link(result.carrier)}{link(result.recovery)}</span></span></div></>;
}

export function VerificationSummary({ result }: { result: Verified }) {
  return <>{result.payload_hash && <HashEvidence evidence={result.payload_hash} />}
    <div className="note note-good"><span><b>{result.verdict}</b><p>{result.message}</p>{link(result.content)}</span></div></>;
}
