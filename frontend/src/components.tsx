import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ChiSquareSegment, HideStep, LectureRow, VerdictName, VerifyStep } from "./api";
import { missingDetail, missingHeading } from "./requirements";
import { stepTone } from "./verdict";
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
  menu: "M3 6h18 M3 12h18 M3 18h18",
  chevronRight: "m9 6 6 6-6 6",
  chevronDown: "m6 9 6 6 6-6",
  arrowRight: "M5 12h14 M13 6l6 6-6 6",
  refresh: "M21 2v6h-6 M3 12a9 9 0 0 1 15-6.7L21 8 M3 22v-6h6 M21 12a9 9 0 0 1-15 6.7L3 16",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 16v-5 M12 8h.01",
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

export function Panel({ step, title, subtitle, aside, children, className = "", id, "aria-busy": busy }: {
  step?: string; title: string; subtitle?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string; "aria-busy"?: boolean;
}) {
  return (
    <section className={`panel ${className}`} id={id} aria-busy={busy}>
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

/**
 * A file slot. `label` stays above the slot after a file is chosen, so a filled slot still
 * says which slot it is — a filename on its own does not.
 */
export function DropZone({ title, hint, accept, file, onFile, icon = "upload", label, id, tone = "" }: {
  title: string; hint: string; accept?: string; file: File | null; onFile: (file: File | null) => void;
  icon?: IconName; label?: ReactNode; id?: string; tone?: "" | "bad";
}) {
  const slot = <DropSlot title={title} hint={hint} accept={accept} file={file} onFile={onFile} icon={icon} id={id} tone={tone} />;
  if (!label) return slot;
  return (
    <div className="slot">
      <span className="slot-label">{label}</span>
      {slot}
    </div>
  );
}

function DropSlot({ title, hint, accept, file, onFile, icon, id, tone }: {
  title: string; hint: string; accept?: string; file: File | null; onFile: (file: File | null) => void;
  icon: IconName; id?: string; tone: "" | "bad";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => input.current?.click();
  return (
    <div
      id={id}
      className={`drop${over ? " over" : ""}${file ? " filled" : ""}${tone ? ` ${tone}` : ""}`}
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
  const fieldId = `${useId()}pem`;
  const readFile = (file: File | null | undefined) => {
    if (file) void file.text().then(onChange);
  };
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={fieldId}>{label}</label>
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
        id={fieldId}
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

export function PassphraseField({ value, onChange, hint, label = "Shared password", placeholder = "Agreed in person, never sent with the file", inputRef }: {
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  label?: string;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [show, setShow] = useState(false);
  const fieldId = `${useId()}passphrase`;
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={fieldId}>{label}</label>
        <button type="button" className="link-btn" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
      </div>
      <input id={fieldId} ref={inputRef} type={show ? "text" : "password"} value={value} autoComplete="off"
        placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}

/**
 * The one place a screen's primary action lives: the bottom of the form column.
 *
 * `missing` drives the blocked state. The reason block gets a stable id which is handed to
 * the render function, so the button can point at it with aria-describedby and a disabled
 * action can never be silent about why.
 */
export function ActionBar({ missing = [], heading, detail, tone = "", children }: {
  missing?: string[];
  heading?: string;
  detail?: ReactNode;
  tone?: "" | "warn";
  children: (reasonId: string) => ReactNode;
}) {
  const reasonId = `${useId()}action-reason`;
  const blocked = missing.length > 0;
  const shownHeading = heading ?? missingHeading(missing);
  const shownDetail = detail ?? missingDetail(missing);
  return (
    <div className={`action-bar${blocked ? " blocked" : ""}${tone ? ` ${tone}` : ""}`}>
      <div className="action-why" id={reasonId}>
        <b>{shownHeading}</b>
        {shownDetail && <span>{shownDetail}</span>}
      </div>
      <div className="action-buttons">{children(reasonId)}</div>
    </div>
  );
}

/**
 * Progressive disclosure that cannot change behaviour by being opened.
 *
 * `value` is printed on the closed summary, so a collapsed panel always states its own live
 * setting and no active choice is ever invisible. Open state is internal unless `open` is
 * supplied, in which case the caller owns it.
 */
export function Disclosure({ title, value, tone = "", defaultOpen = false, open, onOpenChange, children }: {
  title: ReactNode;
  value?: ReactNode;
  tone?: "" | "warn";
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const bodyId = `${useId()}disclosure`;
  const toggle = () => {
    if (open === undefined) setInternalOpen(!isOpen);
    onOpenChange?.(!isOpen);
  };
  return (
    <div className={`disclose${isOpen ? " open" : ""}${tone ? ` ${tone}` : ""}`}>
      <button type="button" className="disclose-summary" aria-expanded={isOpen} aria-controls={bodyId} onClick={toggle}>
        <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={16} />
        <span className="disclose-title">{title}</span>
        {value !== undefined && <span className="disclose-value">{value}</span>}
      </button>
      <div className="disclose-body" id={bodyId} hidden={!isOpen}>{children}</div>
    </div>
  );
}

/**
 * Modal confirmation for an action that cannot be undone. Focus moves to the dialog, Escape
 * and the scrim cancel, and Tab is kept inside while it is open.
 */
export function ConfirmDialog({ title, confirmLabel, cancelLabel = "Cancel", danger = false, onConfirm, onCancel, children }: {
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const headingId = `${useId()}dialog-title`;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = dialog.current.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]:not([tabindex='-1'])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onCancel]);

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={headingId} ref={dialog}>
        <h2 id={headingId}>{title}</h2>
        {children}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={`btn ${danger ? "solid-danger" : "primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/**
 * The headline of a result. Sits at the top of the viewport, takes focus after the run and is
 * announced, so an outcome is never rendered off-screen. Colour, icon and words always agree.
 */
export function Outcome({ tone, icon, label, title, summary, actions, headingRef }: {
  tone: "good" | "bad" | "warn" | "flat";
  icon: IconName;
  label: string;
  title: string;
  summary?: ReactNode;
  actions?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div className={`outcome ${tone}`} role="status" aria-live="polite">
      <span className="outcome-icon"><Icon name={icon} size={26} /></span>
      <div className="outcome-text">
        <span className="outcome-label">{label}</span>
        <h2 ref={headingRef} tabIndex={-1}>{title}</h2>
        {summary && <p>{summary}</p>}
      </div>
      {actions && <div className="outcome-actions">{actions}</div>}
    </div>
  );
}

/**
 * The one way a result says it no longer describes the form. Sits directly above the dimmed
 * result, so the stale state is stated rather than left to be inferred from a faded panel.
 */
export function StaleBanner({ reason, busy = false, onRerun, onDismiss }: {
  reason: string;
  busy?: boolean;
  onRerun: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="note note-warn" role="status">
      <Icon name="alert" />
      <span>
        <b>This result is out of date.</b> {reason} It no longer describes what is in the form.
        <span className="note-actions">
          <button type="button" className="btn primary sm" onClick={onRerun} disabled={busy} aria-busy={busy}>
            {busy ? <Spinner /> : <Icon name="refresh" size={14} />} Check again
          </button>
          <button type="button" className="btn quiet sm" onClick={onDismiss}>Dismiss</button>
        </span>
      </span>
    </div>
  );
}

/** A number with a line saying whether the number is good. */export function Metric({ label, value, reading, tone = "" }: {
  label: string; value: ReactNode; reading?: ReactNode; tone?: "" | "good" | "warn" | "bad";
}) {
  return (
    <div className={`metric${tone ? ` ${tone}` : ""}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {reading && <span className="metric-reading">{reading}</span>}
    </div>
  );
}

/** Collapses the inputs that produced a result into one line, with a way back to them. */
export function InputStrip({ items, actions }: {
  items: { label: string; value: ReactNode; icon?: IconName }[];
  actions?: ReactNode;
}) {
  return (
    <div className="input-strip">
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 && <span className="strip-divider" />}
          <span className="strip-item">
            {item.icon && <Icon name={item.icon} size={15} />}
            {item.label} <b>{item.value}</b>
          </span>
        </Fragment>
      ))}
      {actions && <span className="strip-actions">{actions}</span>}
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

export function Meter({ used, total, label, reading }: {
  used: number | null; total: number | null; label?: string; reading?: ReactNode;
}) {
  const header = label && (
    <div className="meter-head">
      <span className="meter-label">{label}</span>
      {reading && <span className="meter-reading">{reading}</span>}
    </div>
  );
  if (used === null || total === null) {
    return (
      <div className="meter">
        {header}
        <div className="meter-track"><span style={{ width: "0%" }} /></div>
        <small>Add a cover and something to hide to see how much room there is.</small>
      </div>
    );
  }
  const percent = total > 0 ? (used / total) * 100 : Infinity;
  const tone = percent > 100 ? "bad" : percent > 75 ? "warn" : "good";
  return (
    <div className={`meter ${tone}`}>
      {header}
      <div className="meter-track"><span style={{ width: `${Math.min(100, percent)}%` }} /></div>
      <small>
        {percent > 100
          ? `Too large: needs ${used.toLocaleString()} bytes, cover holds ${total.toLocaleString()} bytes`
          : `${used.toLocaleString()} of ${total.toLocaleString()} bytes (${percent.toFixed(1)}%)`}
      </small>
    </div>
  );
}

export function ByteDiagram({ nLsb, caption }: { nLsb: number; caption?: ReactNode }) {
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
      <small>{caption ?? "the top bits stay · the bottom bit carries the hidden content"}</small>
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
      {steps.map((step, index) => {
        const tone = stepTone(step);
        return (
          <li key={step.id} className={tone} style={{ animationDelay: `${index * 70}ms` }}>
            <span className="check-icon">
              <Icon name={tone === "passed" ? "check" : tone === "failed" ? "x" : tone === "override" ? "target" : "minus"} size={14} />
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail || (step.status === "skipped" ? "Not reached" : "")}</p>
            </div>
            <span className="check-tail">
              {tone === "override" ? <span className="chip warn">override</span> : tone === "skipped" ? null : <span className={`chip ${tone === "passed" ? "good" : "bad"}`}>{step.status}</span>}
            </span>
          </li>
        );
      })}
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

/**
 * The verdict as a chip. Kept because it is the one place the raw verdict name is shown next to
 * something else, and because "Payload Missing" must stay recognisable as the backend's name.
 */
export function VerdictChip({ verdict }: { verdict: VerdictName }) {
  return <span className={`chip ${VERDICT_TONE[verdict]}`}>{verdict}</span>;
}

export function LectureTable({ rows, nLsb }: { rows: LectureRow[]; nLsb: number }) {
  return (
    <div className="table-wrap">
      <table className="lecture">
        <thead>
          <tr><th>Position</th><th>Where</th><th>Original data</th><th>Hidden content bits</th><th>Protected data</th></tr>
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

export function ChiStrip({ values, segments, threshold = 0.95 }: { values: (number | null)[]; segments?: ChiSquareSegment[]; threshold?: number }) {
  return (
    <div className="chi" role="img" aria-label="Chi-square p-value per segment">
      {values.map((p, index) => (
        <div key={index} className="chi-bar" title={segments?.[index]
          ? `Segment ${index + 1}: ${segments[index].sample_count} samples, ${segments[index].valid_category_count} valid pairs; ${p === null ? segments[index].reason : `p = ${p.toFixed(4)}`}`
          : p === null ? `Segment ${index + 1}: not enough data` : `Segment ${index + 1}: p = ${p.toFixed(4)}`}>
          <span style={{
            height: `${Math.max(2, (p ?? 0) * 100)}%`,
            background: p === null ? "var(--line)" : p >= threshold ? "var(--coral)" : p >= 0.5 ? "var(--amber)" : "var(--teal)",
          }} />
        </div>
      ))}
    </div>
  );
}
