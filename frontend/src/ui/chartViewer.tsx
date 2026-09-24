import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4];

export function ChartViewer({ title, children, footer }: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [zoomIndex, setZoomIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const popOutButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const zoom = ZOOM_LEVELS[zoomIndex];

  useEffect(() => {
    if (!expanded || !dialog.current || dialog.current.open) return;
    dialog.current.showModal();
  }, [expanded]);

  function close() {
    dialog.current?.close();
    setExpanded(false);
    popOutButton.current?.focus();
  }

  function viewer(popOut: boolean) {
    return (
      <div className={`chart-viewer${popOut ? " chart-viewer-large" : ""}`}>
        <div className="chart-toolbar" role="group" aria-label={`${title} controls`}>
          {!popOut && <span className="chart-toolbar-title">{title}</span>}
          <button type="button" className="btn ghost sm" disabled={zoomIndex === 0}
            aria-label={`Zoom out ${title}`} onClick={() => setZoomIndex(zoomIndex - 1)}>−</button>
          <output aria-label={`${title} zoom level`} aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button type="button" className="btn ghost sm" disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            aria-label={`Zoom in ${title}`} onClick={() => setZoomIndex(zoomIndex + 1)}>+</button>
          <button type="button" className="btn ghost sm" disabled={zoomIndex === 0}
            aria-label={`Reset zoom for ${title}`}
            onClick={() => setZoomIndex(0)}>Reset zoom</button>
          {!popOut && <button ref={popOutButton} type="button" className="btn ghost sm chart-popout"
            aria-label={`Pop out ${title}`}
            onClick={() => setExpanded(true)}>Pop out graph</button>}
        </div>
        <div className="chart-viewport" tabIndex={zoomIndex > 0 ? 0 : undefined}
          aria-label={`${title} at ${Math.round(zoom * 100)}% zoom`}>
          <div className="chart-zoom-content" style={{ width: `${zoom * 100}%` }}>{children}</div>
        </div>
        {footer}
      </div>
    );
  }

  return <>
    {viewer(false)}
    {expanded && createPortal(
      <dialog ref={dialog} className="chart-dialog" aria-labelledby={titleId}
        onClose={() => { setExpanded(false); popOutButton.current?.focus(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="chart-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn ghost sm" onClick={close}>Close enlarged graph</button>
        </div>
        {viewer(true)}
      </dialog>, document.body,
    )}
  </>;
}
