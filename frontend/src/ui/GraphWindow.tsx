import { useEffect, useRef, useState } from "react";
import { Histogram } from "./charts";
import { EvidenceAreaChart, EvidenceBarChart } from "./evidenceChart";
import { closeGraphWindow, requestGraph, watchGraph, type GraphSnapshot } from "./graphHandoff";

const LEVELS = [1, 1.5, 2, 3, 4];

export function GraphWindow({ id, onClose }: { id: string; onClose?: () => void }) {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    let changed = false;
    const stop = watchGraph(id, (value) => { if (alive) { changed = true; setSnapshot(value); setLoading(false); } });
    void requestGraph(id).then((value) => {
      if (alive && !changed) { setSnapshot(value); setLoading(false); }
    });
    return () => { alive = false; stop(); };
  }, [id]);

  useEffect(() => {
    if (!snapshot) return;
    document.title = `${snapshot.title} — Stegloc`;
    heading.current?.focus();
  }, [snapshot?.title]);

  useEffect(() => {
    const onUnload = () => closeGraphWindow(id);
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [id]);

  function close() {
    closeGraphWindow(id);
    if (onClose) { onClose(); return; }
    if (window.pywebview?.api) { void window.pywebview.api.close_graph(id); return; }
    window.close();
  }

  const zoom = LEVELS[zoomIndex];
  return <main className="graph-screen">
    <header className="graph-screen-header">
      <div><span className="topbar-context">Inspect a file / Graph detail</span>
        <h1 ref={heading} tabIndex={-1}>{snapshot?.title ?? "Graph detail"}</h1>
        <p>Measured values from the current analysis session. This view does not establish whether a message is hidden.</p>
      </div>
      <button type="button" className="btn ghost" onClick={close}>Close graph window</button>
    </header>
    {loading && <p className="analysis-empty" role="status">Loading graph from the main window…</p>}
    {!loading && !snapshot && <div className="analysis-empty" role="status">
      The source analysis is no longer available. Return to the main window, inspect a file and open the graph again.
    </div>}
    {snapshot && <section className="graph-screen-panel" aria-label={`${snapshot.title} detail`}>
      <div className="chart-toolbar" role="group" aria-label="Graph controls">
        <strong>Graph workspace</strong>
        <div className="graph-screen-zoom">
          <button type="button" className="btn ghost sm" aria-label="Zoom out" disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((value) => value - 1)}>−</button>
          <output aria-label="Graph zoom level">{Math.round(zoom * 100)}%</output>
          <button type="button" className="btn ghost sm" aria-label="Zoom in" disabled={zoomIndex === LEVELS.length - 1}
            onClick={() => setZoomIndex((value) => value + 1)}>+</button>
          <button type="button" className="btn ghost sm" disabled={zoomIndex === 0}
            onClick={() => setZoomIndex(0)}>Reset zoom</button>
        </div>
      </div>
      <div className="graph-screen-viewport" tabIndex={zoomIndex > 0 ? 0 : undefined}>
        <div className="graph-screen-canvas" style={{ width: `${zoom * 100}%` }}>
          {snapshot.kind === "histogram" ? <>
            <Histogram series={snapshot.series} colors={snapshot.colors} />
            <div className="axis"><span>{snapshot.min}</span><span>{snapshot.axis}</span><span>{snapshot.max}</span></div>
          </> : snapshot.kind === "chi-square"
            ? <EvidenceAreaChart label={snapshot.title} unit="p" max={1} height={440} points={snapshot.points} />
            : <EvidenceBarChart label={snapshot.title} unit={snapshot.unit} max={snapshot.max} height={440} points={snapshot.points} />}
        </div>
      </div>
      {snapshot.kind === "histogram" && <details className="evidence-data" open={snapshot.series[0]?.length <= 8}>
        <summary>View {snapshot.series[0]?.length ?? 0} histogram bins</summary>
        <div className="table-wrap"><table aria-label={`${snapshot.title} data`}>
          <thead><tr><th scope="col">Bin</th>{snapshot.series.map((_, index) => <th scope="col" key={index}>Channel {index + 1}</th>)}</tr></thead>
          <tbody>{Array.from({ length: Math.max(0, ...snapshot.series.map((values) => values.length)) }, (_, index) =>
            <tr key={index}><th scope="row">Bin {index}</th>{snapshot.series.map((values, channel) =>
              <td key={channel}>{values[index] ?? "Unavailable"}</td>)}</tr>)}</tbody>
        </table></div>
      </details>}
      <div className="graph-screen-notes">{snapshot.notes.map((note) => <p key={note}>{note}</p>)}</div>
    </section>}
  </main>;
}
