import { useEffect, useState } from "react";
import { requestJson } from "../api/jobs";
import { DropZone, ErrorNote, Panel, Spinner } from "../components";
import { InspectableImage } from "../ui/InspectableImage";
import { errorText } from "../util";

type Comparison = {width: number; height: number; frame_count: number; fps: number; frame: number;
  stego_preview: string; lsb_preview: string; original_preview: string | null; heatmap: string | null;
  timeline: number[] | null; pixels_changed: number | null; bits_changed: number | null};

const VIDEO_ACCEPT = ".avi,.mp4,.mov,.mkv,.webm,.flv,.wmv,.3gp,.m4v,video/*";

export function VideoInspect({ file, reference, onFile, onReference }: {
  file: File; reference: File | null; onFile: (file: File | null) => void;
  onReference: (file: File | null) => void;
}) {
  const [frame, setFrame] = useState(0);
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setFrame(0), [file]);
  useEffect(() => setResult(null), [file, reference]);
  useEffect(() => {
    let live = true;
    setError(""); setBusy(true);
    const form = new FormData(); form.append("file", file);
    if (reference) form.append("reference", reference);
    form.append("frame", String(frame));
    requestJson<Comparison>("/api/v4/video/compare", {method: "POST", body: form})
      .then((value) => {if (live) setResult(value);})
      .catch((cause) => {if (live) setError(errorText(cause));})
      .finally(() => {if (live) setBusy(false);});
    return () => {live = false;};
  }, [file, reference, frame]);

  const peak = result?.timeline?.reduce((highest, count) => Math.max(highest, count), 1) ?? 1;
  return <div className="form-column video-inspect">
    <Panel title="Files to compare" subtitle="Inspect any supported video. Add its unmodified original to reveal exactly where frames changed.">
      <div className="columns">
        <DropZone label="Video to inspect" title="Choose a video" hint="drop a video or click to browse"
          accept={VIDEO_ACCEPT} icon="eye" file={file} onFile={onFile} />
        <DropZone label="Original video (optional)" title="Add the unmodified original"
          hint="same dimensions, timing and frame count" accept={VIDEO_ACCEPT}
          icon="image" file={reference} onFile={onReference} />
      </div>
      <p className="field-hint">The difference heatmap needs a matching original. The lowest-bit map below works with one video and does not prove that anything is hidden.</p>
    </Panel>

    <Panel title="Choose a frame" subtitle="Move through the video to inspect a particular moment."
      aside={result && <span className="chip flat">{result.width} × {result.height} · {result.frame_count.toLocaleString()} frames · {result.fps.toFixed(2)} fps</span>}>
      {result && <div className="video-frame-control">
        <label htmlFor="video-inspect-frame">Frame {frame + 1} of {result.frame_count}</label>
        <input id="video-inspect-frame" type="range" min="0" max={result.frame_count - 1}
          value={frame} onChange={(event) => setFrame(Number(event.target.value))} />
      </div>}
      {result?.timeline && <div className="video-timeline" aria-label="Changed pixels per frame">{result.timeline.map((count, i) =>
        <button key={i} type="button" aria-label={`Frame ${i + 1}: ${count} changed pixels`}
          title={`Frame ${i + 1}: ${count} changed pixels`} aria-current={frame === i ? "true" : undefined}
          onClick={() => setFrame(i)} style={{height: `${Math.max(4, count / peak * 64)}px`}} />)}</div>}
      {result?.pixels_changed !== null && result?.pixels_changed !== undefined &&
        <p className="field-hint">Frame {frame + 1}: {result.pixels_changed.toLocaleString()} pixels and {result.bits_changed?.toLocaleString()} bits changed from the original.</p>}
      {busy && <p role="status"><Spinner /> Loading frame…</p>}
      <ErrorNote text={error} />
    </Panel>

    {result && <Panel title="Frame evidence" subtitle={`Frame ${result.frame + 1}. Select an image to enlarge it, then drag over a region to inspect it closely.`} aria-busy={busy}>
      <div className="video-evidence-grid">
        {result.original_preview && <figure className="video-evidence-box">
          <figcaption>Original frame</figcaption>
          <InspectableImage src={result.original_preview} alt="Unmodified original video frame" />
        </figure>}
        <figure className="video-evidence-box">
          <figcaption>Inspected frame</figcaption>
          <InspectableImage src={result.stego_preview} alt="Inspected video frame" />
        </figure>
        {result.heatmap ? <figure className="video-evidence-box">
          <figcaption>Difference heatmap</figcaption>
          <InspectableImage src={result.heatmap} alt="Video changes amplified in a heatmap" />
          <p>Pixel differences from the original, amplified 64× for visibility.</p>
        </figure> : <figure className="video-evidence-box">
          <figcaption>Lowest-bit RGB map</figcaption>
          <InspectableImage src={result.lsb_preview} alt="Lowest bit of each RGB channel in the inspected frame" />
          <p>Shows the lowest bit in each colour channel; this is descriptive, not a change heatmap.</p>
        </figure>}
      </div>
    </Panel>}
  </div>;
}
