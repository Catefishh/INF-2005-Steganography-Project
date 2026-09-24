import { useEffect, useState } from "react";
import type { Handoff } from "../util";
import { errorText } from "../util";
import { requestJson } from "../api/jobs";

type Comparison = {width: number; height: number; frame_count: number; fps: number; frame: number;
  stego_preview: string; original_preview: string | null; heatmap: string | null;
  timeline: number[] | null; pixels_changed: number | null; bits_changed: number | null};

export function VideoInspect({ handoff }: {handoff: Handoff}) {
  const [frame, setFrame] = useState(0);
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"side" | "heatmap">("side");
  useEffect(() => {
    let live = true;
    const form = new FormData(); form.append("file", handoff.stego);
    if (handoff.cover) form.append("reference", handoff.cover);
    form.append("frame", String(frame));
    requestJson<Comparison>("/api/v4/video/compare", {method: "POST", body: form})
      .then((value) => {if (live) {setResult(value); setError("");}})
      .catch((cause) => {if (live) setError(errorText(cause));});
    return () => {live = false;};
  }, [handoff.id, frame]);
  return <section className="panel"><h2>Inspect video frames</h2>
    <p>{handoff.stego.name}. The prepared lossless cover is the comparison reference.</p>
    {error && <p role="alert">{error}</p>}
    {result && <><p>{result.width}×{result.height} · {result.frame_count} frames · {result.fps.toFixed(2)} fps</p>
      <label>Frame {frame + 1} of {result.frame_count}<input type="range" min="0" max={result.frame_count - 1} value={frame}
        onChange={(e) => setFrame(Number(e.target.value))} /></label>
      {result.original_preview && <div className="segmented"><button type="button" className={mode === "side" ? "on" : ""} onClick={() => setMode("side")}>Side by side</button>
        <button type="button" className={mode === "heatmap" ? "on" : ""} onClick={() => setMode("heatmap")}>Heatmap</button></div>}
      {mode === "side" && result.original_preview ? <div className="planes two"><figure><img src={result.original_preview} alt="Prepared cover frame" /><figcaption>Prepared cover</figcaption></figure>
        <figure><img src={result.stego_preview} alt="Protected frame" /><figcaption>Protected AVI</figcaption></figure></div> :
        <img src={result.heatmap ?? result.stego_preview} alt={result.heatmap ? "Amplified difference heatmap" : "Protected video frame"} />}
      {result.pixels_changed !== null && <p>Frame {frame + 1}: {result.pixels_changed.toLocaleString()} pixels and {result.bits_changed?.toLocaleString()} bits changed. Heatmap amplified 64×.</p>}
      {result.timeline && <div className="video-timeline" aria-label="Changed pixels per frame">{result.timeline.map((count, i) =>
        <button key={i} type="button" aria-label={`Frame ${i + 1}: ${count} changed pixels`} title={`Frame ${i + 1}: ${count} changed pixels`}
          onClick={() => setFrame(i)} style={{height: `${Math.max(4, count / result.timeline!.reduce((highest, value) => Math.max(highest, value), 1) * 64)}px`}} />)}</div>}
    </>}
  </section>;
}
