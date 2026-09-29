import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";

/** Shared drag selection for the inline chart and its separate graph window. */
export function useDragZoom() {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<{startX: number; startY: number; x: number; y: number} | null>(null);
  const [focus, setFocus] = useState<{x: number; y: number} | null>(null);

  useLayoutEffect(() => {
    if (!focus || !viewport.current) return;
    viewport.current.scrollLeft = focus.x * zoom - viewport.current.clientWidth / 2;
    viewport.current.scrollTop = focus.y * zoom - viewport.current.clientHeight / 2;
    setFocus(null);
  }, [focus, zoom]);

  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
      y: Math.min(rect.height, Math.max(0, event.clientY - rect.top))};
  }

  function reset() {
    setZoom(1);
    if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; }
  }

  return {
    viewport, zoom, setZoom, reset,
    selection: selection && <span className="drag-zoom-selection" aria-hidden="true" style={{
      left: Math.min(selection.startX, selection.x), top: Math.min(selection.startY, selection.y),
      width: Math.abs(selection.x - selection.startX), height: Math.abs(selection.y - selection.startY),
    }} />,
    drag: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !(event.target as Element).closest("svg")) return;
        const {x, y} = point(event);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setSelection({startX: x, startY: y, x, y});
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        if (selection) setSelection({...selection, ...point(event)});
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (!selection || !viewport.current) return;
        const end = point(event);
        const width = Math.abs(end.x - selection.startX);
        const height = Math.abs(end.y - selection.startY);
        setSelection(null);
        if (width < 8 || height < 8) return;
        const next = Math.min(16, zoom * Math.min(
          viewport.current.clientWidth / width, viewport.current.clientHeight / height,
        ));
        if (next <= zoom) return;
        setFocus({x: (selection.startX + end.x) / 2 / zoom, y: (selection.startY + end.y) / 2 / zoom});
        setZoom(next);
      },
      onPointerCancel() { setSelection(null); },
    },
  };
}
