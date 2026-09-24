import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/plus-jakarta-sans/latin-400.css";
import "@fontsource/plus-jakarta-sans/latin-500.css";
import "@fontsource/plus-jakarta-sans/latin-600.css";
import "@fontsource/plus-jakarta-sans/latin-700.css";
import "./styles.css";

const GraphWindow = lazy(() => import("./ui/GraphWindow").then(({ GraphWindow }) => ({ default: GraphWindow })));
const graphId = /^\/graph\/([^/]+)$/.exec(window.location.pathname)?.[1];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {graphId ? <Suspense fallback={<main className="graph-screen" role="status">Loading graph window…</main>}>
      <GraphWindow id={graphId} />
    </Suspense> : <App />}
  </StrictMode>,
);
