import { useState } from "react";
import type { Analysis } from "../../api";
import { inspectCopy } from "../../analysis";
import { Metric, Panel } from "../../components";

/** The panel that only an exact comparison can produce: what changed, where, and by how much. */
export function DiffPanel({ analysis }: { analysis: Analysis }) {
  const compare = analysis.compare!;
  const [split, setSplit] = useState(50);
  const [opacity, setOpacity] = useState(55);
  const [mode, setMode] = useState<"swipe" | "side" | "heatmap" | "overlay">("swipe");
  const copy = inspectCopy(analysis.info.kind);
  const percent = analysis.info.n_slots > 0 ? (compare.slots_changed / analysis.info.n_slots) * 100 : 0;
  const oneBitPerValue = compare.slots_changed > 0 && compare.bits_changed === compare.slots_changed;

  return (
    <Panel title={copy.differenceTitle} subtitle="Every changed value, against the original you supplied.">
      <div className="metrics">
        {analysis.info.kind === "image" && <>
          <Metric label="Pixels changed" value={(compare.pixels_changed ?? 0).toLocaleString()} reading="Distinct image positions with at least one changed colour channel." />
          <Metric label="SSIM" value={compare.ssim === null || compare.ssim === undefined ? "Unavailable" : compare.ssim.toFixed(5)}
            reading="Full-resolution luminance structural similarity. Images smaller than 11×11 have no SSIM result." />
          <Metric label="MSE" value={compare.mse.toFixed(6)} reading="Mean squared error across RGB values." />
          <Metric label="PSNR" value={compare.psnr_db === null ? "∞ dB" : `${compare.psnr_db.toFixed(2)} dB`} reading="∞ means both images are identical." />
        </>}
        <Metric label="Values changed" value={<>{compare.slots_changed.toLocaleString()} <small>of {analysis.info.n_slots.toLocaleString()}</small></>}
          tone={compare.slots_changed ? "warn" : "good"}
          reading={compare.slots_changed
            ? `${percent < 0.1 ? "Under 0.1" : percent.toFixed(1)}% of the file. ${oneBitPerValue ? "One bit per value changed; this is consistent with LSB replacement but does not prove it." : `${compare.bits_changed.toLocaleString()} bits in total.`}`
            : "The file is identical to the original at every value."} />
        <Metric label="Largest change" value={`±${compare.max_difference}`}
          tone={compare.max_difference > 1 ? "bad" : ""}
          reading={compare.max_difference <= 1
            ? "Consistent with one-bit replacement; other causes are possible."
            : "Larger than single-bit replacement alone explains."} />
        {analysis.info.kind === "audio" && <Metric label="Audible change"
          value={compare.psnr_db === null ? "None" : `${compare.psnr_db.toFixed(2)} dB`}
          reading={`PSNR, with an MSE of ${compare.mse.toExponential(2)}. ${compare.psnr_db === null ? "The two files are identical." : compare.psnr_db >= 40 ? "Too small to notice." : "Large enough to hear."}`} />}
      </div>

      {compare.original_preview && compare.stego_preview && <div className="comparison-view">
        <div className="segmented" aria-label="Comparison view">
          {(["swipe", "side", "heatmap", "overlay"] as const).map((choice) =>
            <button key={choice} type="button" className={mode === choice ? "on" : ""} aria-pressed={mode === choice}
              onClick={() => setMode(choice)}>{choice === "side" ? "Side by side" : choice[0].toUpperCase() + choice.slice(1)}</button>)}
        </div>
        {mode === "side" ? <div className="planes two"><figure><img src={compare.original_preview} alt="Original cover" /><figcaption>Before</figcaption></figure>
          <figure><img src={compare.stego_preview} alt="Protected carrier" /><figcaption>After</figcaption></figure></div> :
        <div className="comparison-images">
          <img src={compare.original_preview} alt="Original cover image" />
          {mode === "swipe" && <img className="comparison-stego" src={compare.stego_preview} alt="Stego image" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />}
          {mode === "overlay" && <><img className="comparison-stego" src={compare.stego_preview} alt="Stego image" />
            <img className="comparison-overlay" src={compare.changed_map} alt="Changed pixels highlighted" style={{ opacity: opacity / 100 }} /></>}
          {mode === "heatmap" && <img className="comparison-stego" src={compare.heatmap ?? compare.amplified ?? compare.changed_map} alt="Amplified difference heatmap" />}
        </div>}
        {mode === "swipe" && <label>Before/after split: {split}% <input type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} /></label>}
        {mode === "overlay" && <label>Change overlay: {opacity}% <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>}
        {mode === "heatmap" && <p>Dark = no pixel difference; orange/red = a larger channel change, amplified 64× for visibility. Statistics use full-resolution values.</p>}
      </div>}

      <div className="planes two">
        <figure>
          <img src={compare.changed_map} alt="The locations that changed" />
          <figcaption>White marks every changed {copy.unit} — {compare.slots_changed.toLocaleString()} in total</figcaption>
        </figure>
        {compare.amplified && (
          <figure>
            <img src={compare.amplified} alt="The changed locations, brightened" />
            <figcaption>The same locations, brightness multiplied 64× so a ±1 change becomes visible</figcaption>
          </figure>
        )}
      </div>
      {compare.audio_change_strip && <figure><img src={compare.audio_change_strip} alt="Changes across time and channels" />
        <figcaption>{compare.audio_change_note}</figcaption></figure>}
    </Panel>
  );
}
