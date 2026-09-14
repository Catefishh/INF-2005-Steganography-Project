import { useEffect, useState } from "react";
import { api, type Analysis } from "../api";
import { ChiStrip, DropZone, ErrorNote, Histogram, Icon, Panel, Spinner, Stat } from "../components";
import { errorText, type Handoff } from "../util";

const IMAGE_COLORS = ["#e5483a", "#1f9d55", "#2f6fdb"];

export function AnalysePage({ handoff }: { handoff: Handoff | null }) {
  const [suspect, setSuspect] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [channel, setChannel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);

  useEffect(() => {
    if (handoff) {
      setSuspect(handoff.stego);
      setReference(handoff.cover);
      setResult(null);
    }
  }, [handoff]);

  async function run(selected = channel) {
    if (!suspect) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", suspect, suspect.name);
    if (reference) form.append("compare", reference, reference.name);
    form.append("channel", String(selected));
    try {
      setResult(await api.analyse(form));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const embedded = result ? result.chi_square.filter((p) => p !== null && p >= 0.95).length : 0;

  return (
    <div className="page-grid">
      <Panel step="1" title="Files to analyse" subtitle="Lecture: visual and statistical steganalysis. Add the original cover to also get a difference image."
        aside={<button type="button" className="btn primary" disabled={!suspect || busy} onClick={() => void run()}>
          {busy ? <Spinner /> : <Icon name="layers" />} Analyse
        </button>}>
        <div className="columns">
          <DropZone title="Suspected stego file" hint="image or WAV" accept="image/*,.wav" icon="eye" file={suspect}
            onFile={(file) => { setSuspect(file); setResult(null); }} />
          <DropZone title="Original cover (optional)" hint="same size, for the difference image" accept="image/*,.wav" icon="image"
            file={reference} onFile={(file) => { setReference(file); setResult(null); }} />
        </div>
        <ErrorNote text={error} />
      </Panel>

      {result && (
        <>
          <Panel step="2" title="Bit planes"
            subtitle={`${result.channel_names[result.channel]} channel${result.stride > 1 ? ` (every ${result.stride}${result.info.kind === "audio" ? "th sample" : "th pixel"} shown)` : ""}. High planes carry the picture; low planes look like noise. Hidden data turns a region of the low planes into uniform noise.`}
            aside={
              <div className="segmented">
                {result.channel_names.map((name, index) => (
                  <button key={name} type="button" className={result.channel === index ? "on" : ""} disabled={busy}
                    onClick={() => { setChannel(index); void run(index); }}>{name}</button>
                ))}
              </div>
            }>
            <div className="planes">
              {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => (
                <figure key={bit} className={bit < 2 ? "low" : ""}>
                  <img src={result.bit_planes[bit]} alt={`Bit plane ${bit}`} />
                  <figcaption>Bit {bit}{bit === 7 ? " (MSB)" : bit === 0 ? " (LSB)" : ""}</figcaption>
                </figure>
              ))}
            </div>
            {result.info.kind === "audio" && <p className="muted small">Audio samples are laid out row by row as a square image (one pixel per sample of the chosen channel).</p>}
          </Panel>

          <div className="columns">
            <Panel step="3" title="Chi-square attack (pairs of values)"
              subtitle="Each bar is one segment of the file in embedding order. p close to 1 means the value pairs (2i, 2i+1) are equalised, which LSB replacement with random (encrypted) bits causes.">
              <ChiStrip values={result.chi_square} />
              <div className="legend">
                <span><i style={{ background: "var(--teal)" }} /> p &lt; 0.5 natural</span>
                <span><i style={{ background: "var(--amber)" }} /> 0.5 to 0.95 unclear</span>
                <span><i style={{ background: "var(--coral)" }} /> p ≥ 0.95 looks embedded</span>
              </div>
              <div className="stats">
                <Stat label="Whole channel p" value={result.chi_square_overall === null ? "-" : result.chi_square_overall.toFixed(4)} />
                <Stat label="Suspicious segments" value={`${embedded} / ${result.chi_square.length}`} tone={embedded ? "warn" : "good"} />
              </div>
              <p className="muted small">Limits: flat or very noisy covers can give false positives; for 16-bit and deeper audio the low byte is already noise-like, so this test is only indicative there.</p>
            </Panel>
            <Panel step="4" title="Histogram" subtitle="Lecture: statistical steganalysis. LSB replacement makes neighbouring bins (2i, 2i+1) similar.">
              <Histogram series={result.histograms} colors={result.info.kind === "image" ? IMAGE_COLORS : ["#0fa3a3"]} />
              <div className="axis"><span>0</span><span>value</span><span>255</span></div>
              {result.lsb_composite && (
                <figure className="composite">
                  <img src={result.lsb_composite} alt="LSB of R, G and B" />
                  <figcaption>LSB of R, G and B shown as a colour image</figcaption>
                </figure>
              )}
            </Panel>
          </div>

          {result.compare && (
            <Panel step="5" title="Difference with the original cover" subtitle="Lecture: difference image. Visually identical, but every changed value is shown here.">
              <div className="stats">
                <Stat label="Values changed" value={result.compare.slots_changed.toLocaleString()} />
                <Stat label="Bits changed" value={result.compare.bits_changed.toLocaleString()} />
                <Stat label="Largest change" value={`±${result.compare.max_difference}`} />
                <Stat label="PSNR" value={result.compare.psnr_db === null ? "∞ (identical)" : `${result.compare.psnr_db.toFixed(2)} dB`} />
              </div>
              <div className="planes two">
                <figure><img src={result.compare.changed_map} alt="Changed locations" /><figcaption>White = changed {result.info.kind === "image" ? "pixel" : "sample"}</figcaption></figure>
                {result.compare.amplified && <figure><img src={result.compare.amplified} alt="Amplified difference" /><figcaption>|stego − cover| × 64</figcaption></figure>}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
