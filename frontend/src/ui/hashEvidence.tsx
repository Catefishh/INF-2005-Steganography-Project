export type HashEvidenceData = {
  algorithm: string;
  scope: string;
  expected: string | null;
  computed: string | null;
  status: "match" | "mismatch" | "not_reached" | "unavailable";
  expected_trusted: boolean;
};

export function HashEvidence({ evidence, title = "Payload SHA-256" }: { evidence: HashEvidenceData; title?: string }) {
  const status = { match: "Match", mismatch: "Mismatch", not_reached: "Not reached", unavailable: "Unavailable" }[evidence.status];
  return <section className={`hash-evidence hash-${evidence.status}`} aria-label={title}>
    <div className="hash-heading"><h2>{title}</h2><strong>{status}</strong></div>
    <p>{evidence.scope} · {evidence.expected_trusted ? "Expected digest comes from a verified signature" : "Expected digest is not yet trusted"}</p>
    <div><span>Before / signed expectation</span><code>{evidence.expected ?? "—"}</code></div>
    <div><span>After decoding</span><code>{evidence.computed ?? "Check not reached"}</code></div>
    <p>A matching SHA-256 proves byte equality with the signed expectation. Sender authenticity also requires a valid signature.</p>
  </section>;
}
