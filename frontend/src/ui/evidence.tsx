import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import type { HideStep, LectureRow, VerdictName, VerifyStep } from "../api";
import { stepTone } from "../verdict";
import { Icon } from "./layout";
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

