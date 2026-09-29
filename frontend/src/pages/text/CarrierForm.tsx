import { Meter, Panel } from "../../components";
import { formatBytes } from "../../util";

/** Selects the text carrier and estimates how much visible structure it needs. */
export function CarrierForm({ method, onMethod, message, onMessage, visible, onVisible, onImport,
  estimate }: {
  method: string; onMethod: (value: string) => void;
  message: string; onMessage: (value: string) => void;
  visible: string; onVisible: (value: string) => void;
  onImport: (file: File | undefined) => void;
  estimate: { frame_bytes: number; required_lines_or_symbols: number;
    estimated_carrier_bytes: number; max_carrier_bytes: number } | null;
}) {
  return <Panel title="Choose a text carrier" subtitle="The hidden message is encrypted and signed; visible prose is not authenticated.">
    <div className="field"><label htmlFor="text-method">Method</label><select id="text-method" value={method} onChange={(event) => onMethod(event.target.value)}>
      <option value="acrostic">Acrostic line initials · 4 bits per line</option><option value="whitespace">Trailing spaces and tabs · 1 bit per line</option><option value="zero-width">Zero-width characters · 1 bit per character</option>
    </select></div>
    <div className="field"><label htmlFor="text-message">Message to hide</label><textarea id="text-message" value={message} onChange={(event) => onMessage(event.target.value)} /></div>
    <div className="field"><label htmlFor="text-visible">Visible cover text {method === "acrostic" ? "(generated after protection)" : "(optional)"}</label>
      <textarea id="text-visible" value={visible} onChange={(event) => onVisible(event.target.value)} disabled={method === "acrostic"} />
      {method !== "acrostic" && <input type="file" accept=".txt,text/plain" aria-label="Import visible text" onChange={(event) => onImport(event.target.files?.[0])} />}</div>
    {estimate && <p className="field-hint">Encrypted frame: {estimate.frame_bytes.toLocaleString()} bytes; {estimate.required_lines_or_symbols.toLocaleString()} lines or hidden characters required.</p>}
    {estimate && <Meter label="Estimated text carrier size" used={estimate.estimated_carrier_bytes} total={estimate.max_carrier_bytes}
      reading={estimate.estimated_carrier_bytes > estimate.max_carrier_bytes
        ? method === "acrostic" ? "May exceed the 2 MiB limit" : "Exceeds the 2 MiB limit"
        : `${method === "acrostic" ? "At least " : ""}${formatBytes(estimate.max_carrier_bytes - estimate.estimated_carrier_bytes)} left`}
      summary={`${method === "acrostic" ? "Upper-bound estimate" : "Estimated size"}: ${formatBytes(estimate.estimated_carrier_bytes)} of ${formatBytes(estimate.max_carrier_bytes)}`} />}
    {estimate && <p className="field-hint">The bar measures the saved text file against the 2 MiB limit. The selected method determines how many lines or characters the hidden frame needs.</p>}
  </Panel>;
}
