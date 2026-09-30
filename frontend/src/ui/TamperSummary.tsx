import type { Scenario } from "../api";
import { Disclosure, Panel } from "./layout";

const CHECK_NAMES: Record<string, string> = {
  load: "File and key loading", header: "Hidden header", unlock: "Passphrase / start location",
  extract: "Payload extraction", extraction: "Payload extraction", decrypt: "Payload authentication",
  decryption: "Payload authentication", signature: "Signature", payload_hash: "Payload SHA-256",
  content_hash: "Content SHA-256", cover_hash: "Cover SHA-256", carrier_hash: "Carrier SHA-256",
  locator: "Recovery locator", ciphertext_digest: "Encrypted package SHA-256",
  consistency: "Locator / record consistency", size_policy: "File size",
};

const TEST_PURPOSE: Record<string, string> = {
  baseline: "Verifies the unchanged protected file using the public key and passphrase or recovery material you supplied. This is the case to check for your workspace file's authenticity. If it fails, the suite stops before making test changes.",
  wrong_key: "Verifies the same protected file, but generates a new, unrelated public key for this case instead of using your selected sender key. Your workspace keys stay unchanged. Signature rejection is intentional: it checks that another person's key cannot authenticate the sender's signature.",
  wrong_passphrase: "Verifies the unchanged protected file with a different passphrase. Rejection checks that the wrong password cannot unlock the hidden data; it does not indicate a change to the file.",
  clean_cover: "Verifies the separately supplied original cover, not the protected workspace file. Payload Missing is expected only for an unsigned original. If this reference already contains a protected payload, its signature may belong to another key. Use a clean original or remove the optional reference; this result does not describe the current stego file.",
  flip_cover_bit: "Changes one bit outside the embedded payload in a copy of the protected file. It uses your supplied credentials. The payload and signature can remain valid while the cover SHA-256 detects that the surrounding carrier changed.",
  flip_payload_bit: "Changes one encoded bit inside the encrypted payload in a copy of the protected file. It uses your supplied credentials. Payload authentication should reject the edited bytes before their contents can be trusted.",
  lsb_noise: "Overwrites the lowest bit across the entire protected carrier copy, including its hidden header and payload. This tests how verification handles destroyed hidden data. Payload Missing or Cannot Verify is expected when the framing can no longer be read.",
  payload_hash_mismatch: "Changes the decoded message without changing its length, retains the original signed digest, and re-encrypts it. The signature can still be valid because the signed record is unchanged. The decoded payload SHA-256 should fail because the message no longer matches that record.",
  forged_payload: "Models an attacker who knows the passphrase: they replace the content, update its recorded hash, and re-encrypt it. They cannot create a new sender signature. Verification uses your selected public key and should reject the altered signed record, even though decryption succeeds.",
  jpeg: "Re-compresses a copy of the protected image as JPEG and converts it back to PNG. JPEG can destroy hidden header or payload data. This checks rejection after lossy processing; converting back to PNG cannot restore the original hidden bits.",
  click: "Overwrites a short section of a protected audio copy with a loud waveform. Verification uses your supplied credentials and should detect changed audio samples or disrupted hidden data.",
  cover_flip: "Changes a frame pixel outside the embedded package in a video copy. It keeps your recovery material and sender key. The carrier SHA-256 should detect the edit even when the hidden package remains intact.",
  payload_flip: "Changes one bit of the encrypted package in a video copy. It keeps your recovery material and sender key. The encrypted package SHA-256 should reject the changed bytes before decryption.",
  wrong_code: "Verifies the unchanged protected carrier with a different, validly formatted recovery code, keeping the recovery file and sender key. Rejection checks that the wrong secret cannot unlock this file.",
  symbol_damage: "Changes one symbol used to encode the hidden message in a text carrier copy. It keeps your recovery material and sender key. Decoding or authentication should reject the damaged hidden message.",
  visible_wording: "Changes a visible character while preserving the hidden message encoding. Authentic is expected because the signature protects the hidden message, not the surrounding visible wording. This demonstrates the limit of text-carrier integrity checking.",
};

export function TamperSummary({ cases, busy, suite = "tamper" }: { cases: Scenario[]; busy: boolean; suite?: "tamper" | "attack" }) {
  const attack = suite === "attack";
  const attempts = cases.filter((row) => row.attack);
  const succeeded = attempts.filter((row) => row.attack?.succeeded).length;
  const applicable = cases.filter((row) => row.verdict !== "Unsupported");
  const skipped = cases.filter((row) => row.verdict === "Unsupported");
  const verified = applicable.filter((row) => row.verdict === "Authentic").length;
  const expected = applicable.filter((row) => row.as_expected).length;
  const baselineFailed = applicable.length === 1 && applicable[0].id === "baseline" && !applicable[0].as_expected;

  return <Panel title={suite === "attack" ? "Attack simulation summary" : "Tamper test summary"} subtitle={attack ? "Attack succeeded means the attacker achieved the stated goal. Attack failed means that goal was blocked. Destruction can succeed even when verification correctly detects damage." : "As expected means verification matched the test's expected verdict. Unexpected means it did not. Accepted means the file verified as Authentic; Rejected means the file or verification inputs were rejected."}>
    <p className="small">Each row is a separate verification run. The baseline uses your unchanged protected file and selected credentials. Other cases change a copy or substitute an input for that case only; your workspace file and keys stay unchanged. {attack ? "The baseline is a control, not an attack. Each attack states its objective and assumed access." : "Rejection is the expected outcome for negative cases."}{suite === "tamper" && " The visible-wording text case is expected to be accepted because only its hidden message is authenticated."}</p>
    <p>{attack ? `${attempts.length} attacks completed · ${succeeded} succeeded · ${attempts.length - succeeded} failed` : <>{applicable.length} applicable {applicable.length === 1 ? "case" : "cases"} completed · {expected} as expected · {applicable.length - expected} unexpected</>}{busy ? " · Running…" : ""}</p>
    {!attack && <p className="small">Verification: {verified} accepted · {applicable.length - verified} rejected</p>}
    {skipped.length > 0 && <p className="small">Not applicable to this DCT file: {skipped.map((row) => row.title).join(", ")}. These cases are skipped and excluded from verification counts.</p>}
    {baselineFailed && !busy && <p className="note note-error">The supplied file failed baseline verification. Remaining {suite} cases were not run.</p>}
    {applicable.length === 0 ? <p>No applicable test cases have completed.</p> : <div className="table-wrap">
      <table className="attacks">
        <caption>{attack ? "Attack outcomes by objective" : "Verification results by test case"}</caption>
        <thead><tr><th scope="col">Test case / change</th><th scope="col">Failed verification check</th><th scope="col">{attack ? "Attack outcome / reason" : "Test outcome / verification"}</th></tr></thead>
        <tbody>{applicable.map((row) => {
          const authentic = row.verdict === "Authentic";
          const safe = attack ? row.attack ? !row.attack.succeeded : authentic : row.as_expected;
          const failed = row.stages?.filter((stage) => stage.status === "failed") ?? [];
          return <tr key={row.id} className={safe ? "" : "mismatch"}>
            <th scope="row"><strong>{row.title}</strong><p className="attack-what">{row.change}</p></th>
            <td>{failed.length ? failed.map((stage) => CHECK_NAMES[stage.id] ?? stage.id.replaceAll("_", " ")).join(", ")
              : authentic ? "None — verification passed" : "Check details unavailable"}</td>
            <td><strong className={safe ? "attack-ok" : "attack-bad"}>{attack ? row.attack_outcome ?? "Outcome unavailable" : row.as_expected ? "As expected" : "Unexpected"}</strong>
              <p>{!attack && `Verification: ${authentic ? "Accepted" : "Rejected"} · `}{row.verdict}{!row.as_expected && `; expected ${row.expected.join(" or ")}`}</p>
              <Disclosure title="Reasoning">
                {attack && row.attack && <><p><b>Attacker goal:</b> {row.attack.goal}</p><p><b>Assumptions:</b> {row.attack.assumption}</p></>}
                {TEST_PURPOSE[row.id] && <p className="small"><b>What this case checks:</b> {TEST_PURPOSE[row.id]}</p>}
                <p className="small">Expected verdict: {row.expected.join(" or ")}</p>
                <p className="small">{row.as_expected ? authentic
                  ? "The observed verdict matches this scenario's expected outcome. Verification accepted the file."
                  : "The observed verdict matches this scenario's expected outcome. Verification rejected these test inputs as intended. Payload Missing or Cannot Verify alone does not prove tampering."
                  : "The observed verdict does not match this scenario's expected outcome."}</p>
                <p className="small"><b>Observed verification:</b> {row.summary}</p>
              </Disclosure>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </Panel>;
}
