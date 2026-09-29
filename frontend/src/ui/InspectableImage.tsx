import { useEffect, useState } from "react";
import { BitPlaneViewer } from "./BitPlaneViewer";

export function InspectableImage({ src, alt }: {src: string; alt: string}) {
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  useEffect(() => setOrigin(null), [src]);
  return <>
    <button type="button" className="plane-button" aria-label={`Enlarge ${alt}`}
      onClick={(event) => setOrigin(event.currentTarget)}><img src={src} alt={alt} /></button>
    {origin && <BitPlaneViewer key={src} src={src} label={alt} sampling="" origin={origin} onClose={() => setOrigin(null)} />}
  </>;
}
