import { useEffect, useRef, useState, type ReactNode } from "react";
import { registerGraph, unregisterGraph, updateGraph, type GraphSnapshot } from "./graphHandoff";
import { useDragZoom } from "./useDragZoom";


export function ChartViewer({ title, snapshot, children, footer }: {
  title: string;
  snapshot: GraphSnapshot;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [error, setError] = useState("");
  const popOutButton = useRef<HTMLButtonElement>(null);
  const graphIds = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setInterval>>());
  const {viewport, zoom, setZoom, reset, selection, drag} = useDragZoom();

  useEffect(() => {
    for (const id of graphIds.current) updateGraph(id, snapshot);
  }, [snapshot]);

  useEffect(() => {
    const ids = graphIds.current;
    const intervals = timers.current;
    const onClosed = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (ids.delete(id)) popOutButton.current?.focus();
    };
    window.addEventListener("stegloc-graph-closed", onClosed);
    return () => {
      window.removeEventListener("stegloc-graph-closed", onClosed);
      for (const timer of intervals) clearInterval(timer);
      for (const id of ids) unregisterGraph(id);
      ids.clear();
    };
  }, []);

  async function openGraph() {
    setError("");
    let id: string | null = null;
    try {
      id = registerGraph(snapshot);
      graphIds.current.add(id);
      const path = `/graph/${id}`;
      if (window.pywebview?.api) {
        if (!await window.pywebview.api.open_graph(id, title)) throw new Error("Desktop window unavailable");
      } else {
        const popup = window.open(path, "_blank", "popup=yes,width=1180,height=840");
        if (!popup) throw new Error("Popup blocked");
        const interval = setInterval(() => {
          if (popup.closed) {
            clearInterval(interval);
            timers.current.delete(interval);
            if (id) { unregisterGraph(id); graphIds.current.delete(id); }
            popOutButton.current?.focus();
          }
        }, 500);
        timers.current.add(interval);
      }
    } catch {
      if (id) { unregisterGraph(id); graphIds.current.delete(id); }
      setError("Could not open a graph window. Allow pop-ups for Stegloc or try again in the desktop app.");
      popOutButton.current?.focus();
    }
  }

  return <div className="chart-viewer">
    <div className="chart-toolbar" role="group" aria-label={`${title} controls`}>
      <span className="chart-toolbar-title">{title}</span>
      <button type="button" className="btn ghost sm" disabled={zoom <= 1}
        aria-label={`Zoom out ${title}`} onClick={() => setZoom((value) => Math.max(1, value / 1.5))}>−</button>
      <output aria-label={`${title} zoom level`} aria-live="polite">{Math.round(zoom * 100)}%</output>
      <button type="button" className="btn ghost sm" disabled={zoom >= 16}
        aria-label={`Zoom in ${title}`} onClick={() => setZoom((value) => Math.min(16, value * 1.5))}>+</button>
      <button type="button" className="btn ghost sm" disabled={zoom <= 1}
        aria-label={`Reset zoom for ${title}`} onClick={reset}>Reset zoom</button>
      <button ref={popOutButton} type="button" className="btn ghost sm chart-popout"
        aria-label={`Pop out ${title}`} onClick={() => void openGraph()}>Pop out graph</button>
    </div>
    <div ref={viewport} className="chart-viewport" tabIndex={zoom > 1 ? 0 : undefined}
      aria-label={`${title} at ${Math.round(zoom * 100)}% zoom`}>
      <div className="chart-zoom-content" style={{ width: `${zoom * 100}%` }} {...drag}>{children}{selection}</div>
    </div>
    <p className="field-hint">Drag over the graph to zoom into a region.</p>
    {footer}
    {error && <p className="note note-error" role="alert">{error}</p>}
  </div>;
}
