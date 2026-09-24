# Transparent Sidebar and Separate Graph Windows

## Goal

Make the studio sidebar visibly more transparent while preserving contrast. Replace the graph pop-out dialog with a separate Stegloc desktop window (or browser tab/window) dedicated to the selected graph and its measured evidence.

## Decisions

- The current main app, all existing workflow routes, analysis calculations, and file state remain in the main window.
- On desktop, a small pywebview JS bridge opens a second Stegloc window. On the web, the same control opens a new browser tab/window.
- The graph screen has its own title, enlarged plot, zoom controls, measured-value table when applicable, existing explanatory notes, and a Close action. The main window remains interactive.
- The graph screen is transient. Measurements travel between same-origin windows directly; they are not persisted in backend storage, browser storage, logs, query strings, or the URL.
- An unavailable/closed source produces a clear empty state. Closing the graph returns focus to the trigger in the main window where possible.

## Data and window flow

`ChartViewer` takes a typed graph description in addition to its existing inline children. Histogram descriptions contain only channel series, labels, colors and axis range. Chi-square descriptions contain ordered values and validity metadata; null segments remain unavailable, never zero. On click the main window allocates a random graph ID, registers the current description with a window-scoped handoff channel, then asks the pywebview bridge to open `/graph/<id>` using a per-launch authenticated bootstrap URL. Browser mode opens that same route with `window.open` from the click handler. No arbitrary React node, private key, passphrase, payload or full analysis response crosses the channel.

The graph entry point is a small standalone React screen rather than a second copy of the whole App; it requests the description by ID from the opener over `BroadcastChannel`. The main window responds only for a currently registered graph; the graph screen shows an unavailable state on timeout, invalid ID, or missing source. A second graph can be opened without changing the first; IDs are unique and registration is cleaned up when the source viewer unmounts. The graph screen listens for relevant updates or invalidation from its source so it does not misrepresent changed analysis as current. Browser Back and page reload on `/graph/<id>` must render the standalone screen, but after reload without a live source the user sees the unavailable state.

The desktop bridge validates graph IDs and creates only local authenticated graph URLs. The existing desktop bootstrap middleware accepts a validated graph destination and retains its cookie, no-store and same-origin protections; normal bootstrap behavior still redirects to `/`. The FastAPI SPA serves `/graph/{id}` from the frontend build. If opening the second window fails, the main app shows an actionable error rather than silently opening a modal. Browser popup blockers similarly produce a visible message.

## Sidebar styling

Lower the `.rail.sidebar` translucent white gradient to approximately 40–50% alpha over the existing ambient canvas. Keep backdrop blur, saturate, hairline specular border, and soft shadow. Ensure the brand, status, body labels, focus outline, hovered links and active nav pill remain opaque enough for clear reading. Browsers without `backdrop-filter` use an opaque light surface. No layout or collapse behavior changes.

## Verification

- Sidebar remains readable in expanded and collapsed states, including the fallback.
- Frontend tests cover click-to-open, graph handoff, independent child rendering, valid and unavailable datasets, zoom, close/focus, popup failure and browser URL behavior; existing analysis semantics and routes still pass.
- Python tests cover bridge URL validation, multiple window creation, bootstrap redirect and authenticated graph SPA routing. Desktop packaging includes the graph entry point and chart bundle.
- Run frontend tests/build and Python desktop tests, plus a packaged build. Perform manual two-window and browser-popup checks where a visual window harness is available.
