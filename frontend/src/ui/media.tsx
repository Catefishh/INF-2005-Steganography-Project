import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon } from "./layout";
export function CompareSlider({ before, after }: { before: string; after: string }) {
  const [position, setPosition] = useState(50);
  return (
    <div className="compare">
      <img src={after} alt="Protected image" draggable={false} />
      <div className="compare-top" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img src={before} alt="Original image" draggable={false} />
      </div>
      <div className="compare-handle" style={{ left: `${position}%` }}><span /></div>
      <span className="compare-label left">Cover</span>
      <span className="compare-label right">Protected</span>
      <input type="range" min={0} max={100} value={position} aria-label="Slide to compare the original and the protected image"
        onChange={(event) => setPosition(Number(event.target.value))} />
    </div>
  );
}

/**
 * Per-column min/max envelope of channel 0, drawn at a fixed pixel step. Exported for testing —
 * `Waveform` itself needs Web Audio to decode a file, but the shape-picking logic is a pure
 * function over sample data and is what actually decides whether a preview looks flat.
 */
export function waveformColumns(samples: Float32Array | number[], width: number): { low: number; high: number }[] {
  const columns: { low: number; high: number }[] = [];
  const step = Math.max(1, Math.floor(samples.length / Math.max(1, width)));
  for (let x = 0; x < width; x++) {
    const first = x * step;
    if (first >= samples.length) break;
    let low = 1;
    let high = -1;
    for (let i = first; i < Math.min(first + step, samples.length); i++) {
      const value = samples[i];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    columns.push({ low, high });
  }
  return columns;
}

/**
 * Scales an envelope to its own peak so a quiet recording still reads as a waveform instead of
 * collapsing to a near-invisible line. Silence (peak 0) is left alone rather than amplified into
 * noise. `floor` guarantees every column is at least a hairline tall, matching the "always at
 * least 1px" behaviour the drawing already relied on.
 */
export function normalizeColumns(
  columns: { low: number; high: number }[],
  floor = 0.04,
): { low: number; high: number }[] {
  const peak = columns.reduce((max, { low, high }) => Math.max(max, Math.abs(low), Math.abs(high)), 0);
  if (peak === 0) return columns.map(() => ({ low: 0, high: 0 }));
  const gain = Math.max(1, Math.min(1 / peak, 40));
  return columns.map(({ low, high }) => {
    const scaledLow = Math.max(-1, low * gain);
    const scaledHigh = Math.min(1, high * gain);
    if (scaledHigh - scaledLow >= floor) return { low: scaledLow, high: scaledHigh };
    const mid = (scaledLow + scaledHigh) / 2;
    return { low: Math.max(-1, mid - floor / 2), high: Math.min(1, mid + floor / 2) };
  });
}

export function Waveform({ src, color }: { src: string; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const context = new AudioContext();
    setState("loading");
    fetch(src)
      .then((response) => response.arrayBuffer())
      .then((buffer) => context.decodeAudioData(buffer))
      .then((audio) => {
        const element = canvas.current;
        if (cancelled || !element) return;
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(element.clientWidth * ratio));
        const height = Math.max(1, Math.floor(element.clientHeight * ratio));
        element.width = width;
        element.height = height;
        const pen = element.getContext("2d");
        if (!pen) return;
        const samples = audio.getChannelData(0);
        const columns = normalizeColumns(waveformColumns(samples, width));
        pen.clearRect(0, 0, width, height);
        pen.fillStyle = color;
        columns.forEach(({ low, high }, x) => {
          const top = ((1 - high) * height) / 2;
          const bottom = ((1 - low) * height) / 2;
          pen.fillRect(x, top, 1, Math.max(1, bottom - top));
        });
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      })
      .finally(() => {
        void context.close();
      });
    return () => {
      cancelled = true;
    };
  }, [src, color]);

  return (
    <div className="waveform">
      <canvas ref={canvas} />
      {state !== "ready" && <span className="waveform-state">{state === "loading" ? "Drawing waveform…" : "Waveform preview unavailable"}</span>}
    </div>
  );
}

export function MediaPreview({ url, mime, name, text }: { url: string; mime: string; name: string; text?: string }) {
  if (mime.startsWith("image/")) return <img className="media-img" src={url} alt={name} />;
  if (mime.startsWith("audio/")) {
    return (
      <div className="media-audio">
        <Waveform src={url} color="#0fa3a3" />
        <audio controls src={url} />
      </div>
    );
  }
  if (mime.startsWith("video/")) return <video className="media-video" controls src={url} />;
  if (text !== undefined) return <pre className="media-text">{text}</pre>;
  return <div className="media-file"><Icon name="file" size={28} /><span>{name}</span></div>;
}

