import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChiSquareSegment, HideStep, LectureRow, VerdictName, VerifyStep } from "./api";
import { formatBytes } from "./util";

const ICONS = {
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  lock: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  wave: "M22 12h-4l-3 9L9 3l-3 9H2",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  minus: "M5 12h14",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  image: "M3 3h18v18H3z M8.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z M21 15l-5-5L5 21",
  music: "M9 18V5l12-2v13 M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6",
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  layers: "M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5",
  send: "M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z",
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  copy: "M9 9h13v13H9z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  pen: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z",
  target: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M22 12h-4 M6 12H2 M12 6V2 M12 22v-4",
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Panel({ step, title, subtitle, aside, children, className = "", "aria-busy": busy }: {
  step?: string; title: string; subtitle?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; "aria-busy"?: boolean;
}) {
  return (
    <section className={`panel ${className}`} aria-busy={busy}>
      <header className="panel-head">
        {step && <span className="panel-step">{step}</span>}
        <div className="panel-titles">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {aside && <div className="panel-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function ErrorNote({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="note note-error" role="alert">
      <Icon name="alert" /> <span>{text}</span>
    </div>
  );
}

export function DropZone({ title, hint, accept, file, onFile, icon = "upload" }: {
  title: string; hint: string; accept?: string; file: File | null; onFile: (file: File | null) => void; icon?: IconName;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => input.current?.click();
  return (
    <div
      className={`drop${over ? " over" : ""}${file ? " filled" : ""}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const dropped = event.dataTransfer.files.item(0);
        if (dropped) onFile(dropped);
      }}
    >
      <input ref={input} type="file" accept={accept} hidden onChange={(event) => {
        const picked = event.target.files?.item(0);
        if (picked) onFile(picked);
        event.target.value = "";
      }} />
      <span className="drop-icon"><Icon name={file ? "check" : icon} size={22} /></span>
      <span className="drop-text">
        <strong>{file ? file.name : title}</strong>
        <small>{file ? `${formatBytes(file.size)} · drop or click to replace` : hint}</small>
      </span>
      {file && (
        <button type="button" className="icon-btn" aria-label="Remove file" onClick={(event) => {
          event.stopPropagation();
          onFile(null);
        }}>
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

export function KeyField({ label, value, onChange, placeholder, vaultPem, vaultLabel }: {
  label: string; value: string; onChange: (pem: string) => void; placeholder: string; vaultPem?: string; vaultLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const readFile = (file: File | null | undefined) => {
    if (file) void file.text().then(onChange);
  };
  return (
    <div className="field">
      <div className="field-head">
        <label>{label}</label>
        <span className="field-actions">
          {vaultPem && vaultPem !== value && (
            <button type="button" className="link-btn" onClick={() => onChange(vaultPem)}>{vaultLabel}</button>
          )}
          <button type="button" className="link-btn" onClick={() => input.current?.click()}>Load .pem</button>
        </span>
      </div>
      <input ref={input} type="file" accept=".pem,.key,.pub,.txt" hidden onChange={(event) => {
        readFile(event.target.files?.item(0));
        event.target.value = "";
      }} />
      <textarea
        className={`pem${over ? " over" : ""}`}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          readFile(event.dataTransfer.files.item(0));
        }}
      />
    </div>
  );
}

export function PassphraseField({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <div className="field-head">
        <label>Shared passphrase</label>
        <button type="button" className="link-btn" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
      </div>
      <input type={show ? "text" : "password"} value={value} autoComplete="off" placeholder="Agreed in person, never sent with the file"
        onChange={(event) => onChange(event.target.value)} />
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}

export function Stat({ label, value, sub, tone = "" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Meter({ used, total }: { used: number | null; total: number | null }) {
  if (used === null || total === null) {
    return <div className="meter"><div className="meter-track"><span style={{ width: "0%" }} /></div><small>Add a cover and a payload to see the capacity check.</small></div>;
  }
  const percent = total > 0 ? (used / total) * 100 : Infinity;
  const tone = percent > 100 ? "bad" : percent > 75 ? "warn" : "good";
  return (
    <div className={`meter ${tone}`}>
      <div className="meter-track"><span style={{ width: `${Math.min(100, percent)}%` }} /></div>
      <small>
        {percent > 100
          ? `Too large: needs ${used.toLocaleString()} bytes, cover holds ${total.toLocaleString()} bytes`
          : `${used.toLocaleString()} of ${total.toLocaleString()} bytes (${percent.toFixed(1)}%)`}
      </small>
    </div>
  );
}

export function ByteDiagram({ nLsb }: { nLsb: number }) {
  return (
    <div className="byte-diagram" aria-label={`Lowest ${nLsb} bits replaced`}>
      {Array.from({ length: 8 }, (_, index) => {
        const bit = 7 - index;
        return (
          <span key={bit} className={bit < nLsb ? "bit hot" : "bit"}>
            <em>{bit}</em>
          </span>
        );
      })}
      <small>MSB → LSB · coral bits carry the payload</small>
    </div>
  );
}

export function HideTimeline({ steps }: { steps: HideStep[] }) {
  return (
    <ol className="timeline">
      {steps.map((step, index) => (
        <li key={step.title} style={{ animationDelay: `${index * 60}ms` }}>
          <span className="timeline-dot">{index + 1}</span>
          <div>
            <strong>{step.title}</strong>
            {step.detail && <p>{step.detail}</p>}
            {step.value && <code className="hash">{step.value}</code>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function VerifySteps({ steps }: { steps: VerifyStep[] }) {
  return (
    <ol className="checks">
      {steps.map((step, index) => (
        <li key={step.id} className={step.status} style={{ animationDelay: `${index * 70}ms` }}>
          <span className="check-icon">
            <Icon name={step.status === "passed" ? "check" : step.status === "failed" ? "x" : "minus"} size={14} />
          </span>
          <div>
            <strong>{step.title}</strong>
            <p>{step.detail || (step.status === "skipped" ? "Not reached" : "")}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const VERDICT_TONE: Record<VerdictName, string> = {
  Authentic: "good",
  Tampered: "bad",
  "Signature Invalid": "bad",
  "Payload Missing": "warn",
  "Wrong Start Location": "warn",
  "Cannot Verify": "neutral",
};

export function VerdictChip({ verdict }: { verdict: VerdictName }) {
  return <span className={`chip ${VERDICT_TONE[verdict]}`}>{verdict}</span>;
}

export function VerdictBanner({ verdict, summary }: { verdict: VerdictName; summary: string }) {
  const tone = VERDICT_TONE[verdict];
  return (
    <div className={`verdict ${tone}`}>
      <span className="verdict-icon"><Icon name={tone === "good" ? "shield" : tone === "bad" ? "x" : "alert"} size={30} /></span>
      <div>
        <span className="verdict-label">Verdict</span>
        <h3>{verdict}</h3>
        <p>{summary}</p>
      </div>
    </div>
  );
}

export function LectureTable({ rows, nLsb }: { rows: LectureRow[]; nLsb: number }) {
  return (
    <div className="table-wrap">
      <table className="lecture">
        <thead>
          <tr><th>Slot</th><th>Where</th><th>Original data</th><th>Payload bits</th><th>Stego data</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slot}>
              <td className="mono">{row.slot.toLocaleString()}</td>
              <td>{row.location}</td>
              <td className="mono"><Bits bin={row.before_bin} n={nLsb} changed={false} /> <span className="dim">{row.before}</span></td>
              <td className="mono payload-bits">{row.payload_bits}</td>
              <td className="mono"><Bits bin={row.after_bin} n={nLsb} changed={row.before !== row.after} /> <span className="dim">{row.after}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bits({ bin, n, changed }: { bin: string; n: number; changed: boolean }) {
  return (
    <>
      <span>{bin.slice(0, 8 - n)}</span>
      <span className={changed ? "bits-low changed" : "bits-low"}>{bin.slice(8 - n)}</span>
    </>
  );
}

export function CompareSlider({ before, after }: { before: string; after: string }) {
  const [position, setPosition] = useState(50);
  return (
    <div className="compare">
      <img src={after} alt="Stego image" draggable={false} />
      <div className="compare-top" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img src={before} alt="Cover image" draggable={false} />
      </div>
      <div className="compare-handle" style={{ left: `${position}%` }}><span /></div>
      <span className="compare-label left">Cover</span>
      <span className="compare-label right">Stego</span>
      <input type="range" min={0} max={100} value={position} aria-label="Slide to compare cover and stego"
        onChange={(event) => setPosition(Number(event.target.value))} />
    </div>
  );
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
        const step = Math.max(1, Math.floor(samples.length / width));
        pen.clearRect(0, 0, width, height);
        pen.fillStyle = color;
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
          const top = ((1 - high) * height) / 2;
          const bottom = ((1 - low) * height) / 2;
          pen.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
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

export function Histogram({ series, colors }: { series: number[][]; colors: string[] }) {
  let max = 1;
  for (const channel of series) for (const value of channel) if (value > max) max = value;
  return (
    <svg className="histogram" viewBox="0 0 256 100" preserveAspectRatio="none" role="img" aria-label="Value histogram">
      {series.map((channel, index) => (
        <path key={index} stroke={colors[index % colors.length]} strokeWidth={1} opacity={0.7}
          d={channel.map((value, x) => `M${x + 0.5} 100V${100 - (value / max) * 100}`).join("")} />
      ))}
    </svg>
  );
}

export function ChiStrip({ values }: { values: ChiSquareSegment[] }) {
  return (
    <div className="chi" role="img" aria-label="Chi-square p-value per segment">
      {values.map((segment) => (
        <div key={segment.index} className="chi-bar" title={segment.p_value === null ? `Segment ${segment.index + 1}: ${segment.reason ?? "not enough data"}` : `Segment ${segment.index + 1}: ${segment.sample_count} samples, ${segment.valid_category_count} valid pairs, p = ${segment.p_value.toFixed(4)}`}>
          <span style={{
            height: `${Math.max(2, (segment.p_value ?? 0) * 100)}%`,
            background: segment.p_value === null ? "var(--line)" : segment.p_value >= 0.95 ? "var(--coral)" : segment.p_value >= 0.5 ? "var(--amber)" : "var(--teal)",
          }} />
        </div>
      ))}
    </div>
  );
}
