import { Panel } from "../../components";

/** Selects the text carrier and estimates how much visible structure it needs. */
export function CarrierForm({ method, onMethod, message, onMessage, visible, onVisible, onImport,
  onEstimate, estimate }: {
  method: string; onMethod: (value: string) => void;
  message: string; onMessage: (value: string) => void;
  visible: string; onVisible: (value: string) => void;
  onImport: (file: File | undefined) => void;
  onEstimate: () => void;
  estimate: { frame_bytes: number; required_lines_or_symbols: number } | null;
}) {
  return <Panel title="Choose a text carrier" subtitle="The hidden message is encrypted and signed; visible prose is not authenticated.">
    <div className="field"><label htmlFor="text-method">Method</label><select id="text-method" value={method} onChange={(event) => onMethod(event.target.value)}>
      <option value="acrostic">Acrostic line initials</option><option value="whitespace">Trailing spaces and tabs</option><option value="zero-width">Zero-width characters</option>
    </select></div>
    <div className="field"><label htmlFor="text-message">Message to hide</label><textarea id="text-message" value={message} onChange={(event) => onMessage(event.target.value)} /></div>
    <div className="field"><label htmlFor="text-visible">Visible cover text {method === "acrostic" ? "(generated after protection)" : "(optional)"}</label>
      <textarea id="text-visible" value={visible} onChange={(event) => onVisible(event.target.value)} disabled={method === "acrostic"} />
      {method !== "acrostic" && <input type="file" accept=".txt,text/plain" aria-label="Import visible text" onChange={(event) => onImport(event.target.files?.[0])} />}</div>
    <div className="btn-row"><button type="button" className="btn ghost" onClick={onEstimate}>Estimate carrier length</button></div>
    {estimate && <p className="field-hint">Encrypted frame: {estimate.frame_bytes.toLocaleString()} bytes; {estimate.required_lines_or_symbols.toLocaleString()} lines or hidden characters required.</p>}
  </Panel>;
}
