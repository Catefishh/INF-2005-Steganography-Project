import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

export function BitPlaneViewer({ src, label, sampling, onClose, origin }: {
  src: string; label: string; sampling: string; onClose: () => void; origin: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({width: 0, height: 0});
  const [selection, setSelection] = useState<{startX: number; startY: number; x: number; y: number} | null>(null);
  const [focus, setFocus] = useState<{x: number; y: number} | null>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
    return () => { origin?.focus(); };
  }, [origin]);
  useLayoutEffect(() => {
    if (!focus || !scroll.current) return;
    scroll.current.scrollLeft = focus.x * zoom - scroll.current.clientWidth / 2;
    scroll.current.scrollTop = focus.y * zoom - scroll.current.clientHeight / 2;
    setFocus(null);
  }, [focus, zoom]);

  function point(event: PointerEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
      y: Math.min(rect.height, Math.max(0, event.clientY - rect.top))};
  }

  function finishSelection(event: PointerEvent<HTMLImageElement>) {
    if (!selection) return;
    const end = point(event);
    const width = Math.abs(end.x - selection.startX);
    const height = Math.abs(end.y - selection.startY);
    setSelection(null);
    if (width < 8 || height < 8 || !scroll.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const nextZoom = Math.min(16, zoom * Math.min(
      (scroll.current.clientWidth || rect.width) / width,
      (scroll.current.clientHeight || rect.height) / height,
    ));
    if (nextZoom <= zoom) return;
    setFocus({x: (selection.startX + end.x) / 2 / zoom, y: (selection.startY + end.y) / 2 / zoom});
    setZoom(nextZoom);
  }
  return <dialog ref={dialog} className="bit-viewer" aria-label={label} onClose={onClose}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="bit-viewer-toolbar">
      <strong>{label}</strong>
      <div className="btn-row">
        <button type="button" onClick={() => setZoom((value) => Math.max(0.25, value / 2))} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => { setZoom(1); if (scroll.current) { scroll.current.scrollLeft = 0; scroll.current.scrollTop = 0; } }}>Reset zoom</button>
        <button type="button" onClick={() => setZoom((value) => Math.min(16, value * 2))} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => { dialog.current?.close?.(); onClose(); }}>Close</button>
      </div>
    </div>
    {sampling && <p className="field-hint">{sampling}</p>}
    <p className="field-hint">Drag over the image to zoom into a region.</p>
    <div ref={scroll} className="bit-viewer-scroll"><div className="bit-viewer-image">
      <img src={src} alt={label} draggable={false}
        onLoad={(event) => setSize({width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const {x, y} = point(event);
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setSelection({startX: x, startY: y, x, y});
        }}
        onPointerMove={(event) => selection && setSelection({...selection, ...point(event)})}
        onPointerUp={finishSelection}
        onPointerCancel={() => setSelection(null)}
        style={size.width ? {width: size.width * zoom, height: size.height * zoom} : undefined} />
      {selection && <span className="bit-viewer-selection" aria-hidden="true" style={{
        left: Math.min(selection.startX, selection.x), top: Math.min(selection.startY, selection.y),
        width: Math.abs(selection.x - selection.startX), height: Math.abs(selection.y - selection.startY),
      }} />}
    </div></div>
  </dialog>;
}
