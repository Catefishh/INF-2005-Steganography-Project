import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

export function BitPlaneViewer({ src, label, sampling, onClose, origin, onPick, initialPoint }: {
  src: string; label: string; sampling: string; onClose: () => void; origin: HTMLElement | null;
  onPick?: (x: number, y: number) => void; initialPoint?: {x: number; y: number};
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({width: 0, height: 0});
  const [selection, setSelection] = useState<{startX: number; startY: number; x: number; y: number} | null>(null);
  const [focus, setFocus] = useState<{x: number; y: number} | null>(null);
  const [cursor, setCursor] = useState(initialPoint ?? {x: 1, y: 0});
  const [pickError, setPickError] = useState("");
  const [hover, setHover] = useState<{x: number; y: number; clientX: number; clientY: number} | null>(null);
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

  function pixel(event: PointerEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!size.width || !size.height || !rect.width || !rect.height ||
        event.clientX < rect.left || event.clientX >= rect.left + rect.width ||
        event.clientY < rect.top || event.clientY >= rect.top + rect.height) return null;
    return {x: Math.floor((event.clientX - rect.left) / rect.width * size.width),
      y: Math.floor((event.clientY - rect.top) / rect.height * size.height)};
  }

  function choose(x: number, y: number) {
    setCursor({x, y});
    if (x === 0 && y === 0) { setPickError("Pixel (0, 0) cannot be used. Choose another pixel."); return; }
    setPickError("");
    onPick?.(x, y);
  }

  function finishSelection(event: PointerEvent<HTMLImageElement>) {
    if (!selection) return;
    const end = point(event);
    const width = Math.abs(end.x - selection.startX);
    const height = Math.abs(end.y - selection.startY);
    setSelection(null);
    setHover(null);
    if (onPick && width < 8 && height < 8 && size.width && size.height) {
      const picked = pixel(event);
      if (picked) choose(picked.x, picked.y);
      return;
    }
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
    <p className="field-hint">{onPick ? "Click a pixel to choose the start point. Drag to zoom; use arrow keys and Enter for keyboard selection." : "Drag over the image to zoom into a region."}</p>
    {onPick && <p className="field-hint" role="status">Pixel ({cursor.x}, {cursor.y}){pickError && ` — ${pickError}`}</p>}
    <div ref={scroll} className="bit-viewer-scroll"><div className="bit-viewer-image">
      <img src={src} alt={label} draggable={false}
        role={onPick ? "button" : undefined} tabIndex={onPick ? 0 : undefined}
        onLoad={(event) => {
          const width = event.currentTarget.naturalWidth, height = event.currentTarget.naturalHeight;
          setSize({width, height});
          setCursor((point) => ({x: Math.min(point.x, width - 1), y: Math.min(point.y, height - 1)}));
        }}
        onKeyDown={(event) => {
          if (!onPick || !size.width || !size.height) return;
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(cursor.x, cursor.y); return; }
          const move = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
          if (!move) return;
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          setCursor(({x, y}) => ({x: Math.max(0, Math.min(size.width - 1, x + move[0] * step)),
            y: Math.max(0, Math.min(size.height - 1, y + move[1] * step))}));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const {x, y} = point(event);
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setSelection({startX: x, startY: y, x, y});
        }}
        onPointerMove={(event) => {
          if (onPick) {
            const at = pixel(event);
            setHover(at && {...at, clientX: event.clientX, clientY: event.clientY});
          }
          if (selection) setSelection({...selection, ...point(event)});
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={finishSelection}
        onPointerCancel={() => { setSelection(null); setHover(null); }}
        style={size.width ? {width: size.width * zoom, height: size.height * zoom} : undefined} />
      {onPick && size.width > 0 && <span className="bit-viewer-point" aria-hidden="true" style={{
        left: (cursor.x + 0.5) * zoom, top: (cursor.y + 0.5) * zoom,
      }} />}
      {onPick && hover && !selection && <span className="bit-viewer-hover" aria-hidden="true" style={{
        left: hover.clientX + (hover.clientX > window.innerWidth - 120 ? -12 : 12),
        top: hover.clientY + (hover.clientY > window.innerHeight - 48 ? -12 : 12),
        transform: `translate(${hover.clientX > window.innerWidth - 120 ? "-100%" : "0"}, ${hover.clientY > window.innerHeight - 48 ? "-100%" : "0"})`,
      }}>({hover.x}, {hover.y})</span>}
      {selection && <span className="bit-viewer-selection" aria-hidden="true" style={{
        left: Math.min(selection.startX, selection.x), top: Math.min(selection.startY, selection.y),
        width: Math.abs(selection.x - selection.startX), height: Math.abs(selection.y - selection.startY),
      }} />}
    </div></div>
  </dialog>;
}
