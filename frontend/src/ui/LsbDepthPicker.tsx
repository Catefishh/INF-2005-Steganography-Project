import type { RefObject } from "react";
import { ByteDiagram } from "./evidence";

export function LsbDepthPicker({value, onChange, capacity, capacityByDepth, depthRef, riskMessage}: {
  value: number;
  onChange: (value: number) => void;
  capacity: number | null;
  capacityByDepth?: number[];
  depthRef?: RefObject<HTMLDivElement | null>;
  riskMessage?: string;
}) {
  return <div className="field">
    <div className="field-head">
      <span className="field-label">Bits used in each value</span>
      <span className="field-hint">1 is the safest</span>
    </div>
    <div className="lsb-picker" role="radiogroup" aria-label="Bits used in each value" ref={depthRef}
      onKeyDown={(event) => {
        const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = Math.min(8, Math.max(1, value + step));
        onChange(next);
        event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next - 1]?.focus();
      }}>
      {Array.from({length: 8}, (_, index) => index + 1).map((bits) => <button key={bits} type="button"
        role="radio" aria-checked={value === bits} tabIndex={value === bits ? 0 : -1}
        className={`lsb-btn${value === bits ? " on" : ""}${bits > 3 ? " risky" : ""}`}
        title={capacityByDepth ? `${capacityByDepth[bits - 1].toLocaleString()} bytes capacity` : undefined}
        onClick={() => onChange(bits)}>{bits}</button>)}
    </div>
    <ByteDiagram nLsb={value} caption={capacity !== null
      ? `the highlighted bit${value === 1 ? " is" : "s are"} replaced — ${capacity.toLocaleString()} bytes of room`
      : `the lowest ${value} bit${value === 1 ? "" : "s"} of every value ${value === 1 ? "is" : "are"} replaced`} />
    {value > 3 && <p className="muted small">{riskMessage ?? "More bits fit more in, but past 3 the change can become visible or audible."}</p>}
  </div>;
}
