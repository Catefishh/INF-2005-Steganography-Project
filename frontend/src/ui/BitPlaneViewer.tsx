import { useEffect, useRef, useState } from "react";

export function BitPlaneViewer({ src, label, sampling, onClose, origin }: {
  src: string; label: string; sampling: string; onClose: () => void; origin: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({width: 0, height: 0});
  useEffect(() => {
    dialog.current?.showModal?.();
    return () => { origin?.focus(); };
  }, [origin]);
  return <dialog ref={dialog} className="bit-viewer" aria-label={label} onClose={onClose}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="bit-viewer-toolbar">
      <strong>{label}</strong>
      <div className="btn-row">
        <button type="button" onClick={() => setZoom((value) => Math.max(0.25, value / 2))} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => setZoom(1)}>Reset zoom</button>
        <button type="button" onClick={() => setZoom((value) => Math.min(16, value * 2))} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => { dialog.current?.close?.(); onClose(); }}>Close</button>
      </div>
    </div>
    {sampling && <p className="field-hint">{sampling}</p>}
    <div className="bit-viewer-scroll"><img src={src} alt={label} onLoad={(event) => setSize({width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})}
      style={size.width ? {width: size.width * zoom, height: size.height * zoom} : undefined} /></div>
  </dialog>;
}
