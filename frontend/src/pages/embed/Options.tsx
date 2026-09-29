import { useEffect, useState } from "react";
import type { CoverInfo } from "../../api";
import { Disclosure, Icon, LsbDepthPicker } from "../../components";
import { BitPlaneViewer } from "../../ui/BitPlaneViewer";

/**
 * Depth and start point.
 *
 * It sits between "Choose what to hide" and "Lock and sign it", which is where the choices it
 * holds are actually decided: the depth is what sets the capacity the previous card reports, and
 * the start point is where the hidden content begins. It is deliberately **not numbered** — the
 * numbers mark the steps a person works through, and this is a panel of optional settings rather
 * than a step. Its closed summary prints the live setting, so a non-default depth or a manual
 * start is never invisible.
 */
export function EmbeddingOptions({ open, onOpenChange, summary, info, nLsb, onNLsb, capacity, depthRef,
  startMode, onStartMode, startX, startY, startSeconds, onStartX, onStartY, onStartSeconds, manualSlot, coverUrl }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: string;
  info: CoverInfo | null;
  nLsb: number;
  onNLsb: (n: number) => void;
  capacity: number | null;
  depthRef: React.RefObject<HTMLDivElement | null>;
  startMode: "auto" | "manual";
  onStartMode: (mode: "auto" | "manual") => void;
  startX: string;
  startY: string;
  startSeconds: string;
  onStartX: (value: string) => void;
  onStartY: (value: string) => void;
  onStartSeconds: (value: string) => void;
  manualSlot: number | null;
  coverUrl: string | null;
}) {
  const [pickerOrigin, setPickerOrigin] = useState<HTMLElement | null>(null);
  useEffect(() => setPickerOrigin(null), [coverUrl, info?.kind]);
  return (
    <Disclosure title="Embedding options" value={summary} open={open} onOpenChange={onOpenChange}>
      <LsbDepthPicker value={nLsb} onChange={onNLsb} capacity={capacity}
        capacityByDepth={info?.capacity?.map((row) => row.max_package_bytes)} depthRef={depthRef} />

      <div className="field">
        <span className="field-label">Where the hidden data starts</span>
        <div className="segmented">
          <button type="button" className={startMode === "auto" ? "on" : ""} onClick={() => onStartMode("auto")}>
            <Icon name="lock" size={14} /> Work it out from the password
          </button>
          <button type="button" className={startMode === "manual" ? "on" : ""} onClick={() => onStartMode("manual")}>
            <Icon name="target" size={14} /> Choose a spot
          </button>
        </div>
        {startMode === "auto" ? (
          <small className="field-hint">
            Recommended. The start point is worked out from your password and stored encrypted inside the file, so
            only someone with the password can find it.
          </small>
        ) : (
          <>
            <div className="note note-info">
              <Icon name="info" />
              <span>
                Choosing a start point replaces the password-derived location.
              </span>
            </div>
            {info?.kind === "audio" ? (
              <div className="inline-fields">
                <label>Seconds from the start
                  <input type="number" min={0} step="0.001" max={info.duration} value={startSeconds}
                    onChange={(event) => onStartSeconds(event.target.value)} />
                </label>
                <small className="field-hint">
                  {startSeconds} s — channel 1. Position {manualSlot?.toLocaleString() ?? "-"}
                  {info.duration ? ` of ${info.n_slots.toLocaleString()}. Must be inside the ${info.duration.toFixed(2)} s clip.` : "."}
                </small>
              </div>
            ) : info?.kind === "image" ? (
              <div className="field">
                <button type="button" className="btn ghost" disabled={!coverUrl}
                  onClick={(event) => setPickerOrigin(event.currentTarget)}>Open image to choose a pixel</button>
                <small className="field-hint">
                  Selected pixel ({startX}, {startY}) — red value. Position {manualSlot?.toLocaleString() ?? "-"}
                  {` of ${info.n_slots.toLocaleString()}`}.
                </small>
                {pickerOrigin && coverUrl && <BitPlaneViewer src={coverUrl} label="Choose starting pixel" sampling=""
                  origin={pickerOrigin} onClose={() => setPickerOrigin(null)} initialPoint={{x: Number(startX), y: Number(startY)}}
                  onPick={(x, y) => { onStartX(String(x)); onStartY(String(y)); setPickerOrigin(null); }} />}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Disclosure>
  );
}
