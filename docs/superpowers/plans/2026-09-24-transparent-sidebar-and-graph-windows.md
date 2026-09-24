# Transparent Sidebar and Graph Windows Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan in this session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sidebar a clearer frosted-glass appearance and open graph pop-outs in separate authenticated desktop windows or browser tabs.

**Architecture:** Preserve main-window form and analysis state. Introduce typed, ephemeral graph snapshots shared across same-origin windows through BroadcastChannel, a standalone `/graph/<id>` React entry screen, and a narrowly scoped pywebview window-opening bridge. Serve the SPA graph route and bootstrap child windows without changing existing routes or API semantics.

**Tech Stack:** React 19, TypeScript, plain CSS, pywebview, FastAPI, Vitest/Testing Library, pytest.

**Design:** `docs/superpowers/specs/2026-09-24-transparent-sidebar-and-graph-windows-design.md`.

---

## Chunk 1: Graph transport and entry point

### Task 1: Typed graph handoff

**Files:** Create `frontend/src/ui/graphHandoff.ts`, `frontend/src/ui/graphHandoff.test.ts`; modify `frontend/src/pages/analysis/HistogramPanel.tsx`, `frontend/src/pages/analyse/sections.tsx`.

- [ ] Write tests: IDs differ for each pop-out; a responder serves only registered graph IDs; invalidated IDs are unavailable; histogram and chi-square data are structured clone-safe, with null p-values retained.
- [ ] Run `npm test -- --run src/ui/graphHandoff.test.ts`; confirm red.
- [ ] Define a discriminated union `GraphSnapshot` for histogram (series, colors, axis labels) and chi-square (segment p-values, threshold, explanatory copy). Add a window-scoped responder registry with release on viewer unmount, using `BroadcastChannel` and a one-time request ID. Do not serialize JSX, full analysis results, keys or secrets.
- [ ] Run focused tests; confirm green.

### Task 2: Standalone graph screen

**Files:** Create `frontend/src/ui/GraphWindow.tsx`, `frontend/src/ui/GraphWindow.test.tsx`; modify `frontend/src/main.tsx`, `frontend/src/styles.css`.

- [ ] Test the independent `/graph/<id>` entry point: loading state, measured plot and details on response, unavailable state on timeout/invalid ID, close action, zoom; original App does not mount for graph routes.
- [ ] Run focused test; confirm red.
- [ ] Implement `GraphWindow` using the same existing Histogram and EvidenceAreaChart components as the main app; title, enlarged plot, zoom, explanation/measurements and close affordance. Request the registered snapshot by ID. Close via `window.close()` (browser popup) or desktop bridge where available; preserve source-focus restoration where feasible.
- [ ] Run focused test; confirm green.

## Chunk 2: Window creation, styling and integration

### Task 3: Desktop window bridge and graph route

**Files:** Modify `backend/desktop.py`, `backend/app/main.py`, `tests/test_desktop.py`, `tests/test_app.py`.

- [ ] Write Python tests for the bridge rejecting invalid graph IDs and creating multiple local pywebview graph windows with safe titles; bootstrap redirects only to validated graph paths; `/graph/<id>` serves the SPA after authentication and blocks unauthenticated clients.
- [ ] Run `.\.venv\Scripts\python.exe -m pytest tests/test_desktop.py tests/test_app.py -q --basetemp="C:\Users\jwooh\AppData\Local\Temp\opencode\stegloc-graph-pytest"` from repository root; confirm red.
- [ ] Add a dedicated main-window JS API method to open a graph window and a child-window close method. Use the existing loopback bootstrap token and validated `next` path, never accept arbitrary URLs or payload bodies. Keep per-window cookie/no-store protections.
- [ ] Run focused Python tests; confirm green.

### Task 4: Pop-out action and sidebar appearance

**Files:** Modify `frontend/src/ui/chartViewer.tsx`, `frontend/src/ui/chartViewer.test.tsx`, `frontend/src/pages/analysis/HistogramPanel.tsx`, `frontend/src/pages/analyse/sections.tsx`, `frontend/src/styles.css`.

- [ ] Replace dialog expectations with a test that Pop out graph opens `/graph/<id>` in a browser tab and registers a live snapshot; test desktop bridge call and popup-blocker error. Preserve zoom on the source and restore focus after popup closes where supported.
- [ ] Run focused frontend tests; confirm red.
- [ ] Implement browser `window.open` and desktop bridge invocation from the user click. Keep the source visible. Remove dialog-only code and CSS. Pass typed chart snapshots at each analysis call site.
- [ ] Lower sidebar glass fill alpha to 40–50%, preserve blur/border, opaque active pills and fallback; retain collapsed and narrow-window behavior. Check contrast without encoding it in style snapshots.
- [ ] Run focused frontend tests and `npm run build`.

## Chunk 3: Verification

- [ ] Run `npm test -- --run` and `npm run build` from `frontend`.
- [ ] Run `.\.venv\Scripts\python.exe -m pytest -q --basetemp="C:\Users\jwooh\AppData\Local\Temp\opencode\stegloc-graph-pytest"` from repository root.
- [ ] Run `scripts/build-desktop.ps1`; confirm packaged graph chunk and fonts under `dist/Stegloc/_internal/frontend/dist/assets`.
- [ ] Review `git diff --check`, the final diff, and existing route and protocol tests; note if this harness cannot perform visual two-window interaction.
