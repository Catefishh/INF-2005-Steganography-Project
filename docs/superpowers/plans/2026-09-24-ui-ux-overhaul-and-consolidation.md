# Stegloc Studio Overhaul and Consolidation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan in this session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved luminous desktop UI across all active workflows, integrate local shadcn-style sidebar and evidence charts, and consolidate the repository around the current release without removing supported protocol versions.

**Architecture:** Keep React/Vite, the existing history router, mounted page state, plain CSS, and API contracts. Add a small locally owned sidebar and chart boundary, migrate the shared shell and all current workflows via tokens and shared primitives, then audit and remove only verified obsolete files. See `docs/superpowers/specs/2026-09-24-ui-ux-overhaul-and-v4-consolidation-design.md`.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Motion for React, CSS, shadcn-style local primitives, Recharts, Vitest/Testing Library, Python/Pytest, Windows desktop packaging.

---

## File responsibilities

- `frontend/src/ui/sidebar.tsx`: sidebar provider, inset, trigger, menu primitives and desktop collapse behavior; does not own routing.
- `frontend/src/App.tsx`: route links, key status, workspace ownership and composition of the sidebar and pages.
- `frontend/src/ui/evidenceChart.tsx`: Recharts-backed accessible chart surfaces and empty-data handling; does not fetch data.
- `frontend/src/pages/analysis/HistogramPanel.tsx`, `frontend/src/pages/analyse/sections.tsx`, `frontend/src/pages/RobustnessPanel.tsx`: adapt actual evidence to chart views, retain explanatory copy.
- `frontend/src/styles.css`: light glass tokens and layout, global existing primitives, compact opaque technical evidence and reduced-motion support.
- `frontend/src/pages.test.tsx`, `frontend/src/a11y.test.tsx`, analysis tests: behavior-based regressions; avoid style snapshots.
- `README.md`, `PRODUCT.md`, `docs/ui-library-adoption.md`, `.gitignore`: current release and provenance instructions.

## Chunk 1: Baseline and shell

### Task 1: Record behavior and cleanup inventory

- [ ] Run `npm ci`, `npm test -- --run`, and `npm run build` from `frontend`; record baseline.
- [ ] Inspect `frontend/src/router.ts`, `frontend/src/App.tsx`, `frontend/src/pages.test.tsx`, `frontend/src/a11y.test.tsx`, packaging scripts, `git ls-files`, and root docs. Preserve `/keys`, `/embed`, `/embed/result`, `/verify`, `/verify/result`, `/text`, `/inspect`, `/tamper-tests`.
- [ ] Inventory release-version labels separately from protocol-version contracts using content/reference searches; inspect potentially user-owned untracked artifacts before deletion.

### Task 2: Sidebar behavior

**Files:** Create `frontend/src/ui/sidebar.tsx`; modify `frontend/src/App.tsx`, `frontend/src/styles.css`; test `frontend/src/pages.test.tsx`, `frontend/src/a11y.test.tsx`.

- [ ] Add a test: desktop trigger collapses then expands, active link still has `aria-current="page"`, icon-only links retain accessible names, browser Back keeps route focus.
- [ ] Run `npm test -- --run src/pages.test.tsx src/a11y.test.tsx` and observe new test failure.
- [ ] Implement local `SidebarProvider`, `Sidebar`, `SidebarInset`, `SidebarTrigger`, `SidebarMenu`, and `SidebarMenuItem` using semantic links/buttons and context for desktop collapsed state. Keep the current History API click interception, working file, key status, and mounted pages.
- [ ] Verify the focused tests pass; do not change path strings or request payloads.

### Task 3: Visual foundation

**Files:** Modify `frontend/src/styles.css`, `frontend/src/ui/layout.tsx`, `frontend/src/main.tsx` only if required.

- [ ] Add design tokens (luminous canvas, glass elevations, text, focus, semantic verdict colors), bundled/offline-safe Plus Jakarta Sans fallback, and spacing/typography hierarchy.
- [ ] Restyle shell, header, working-file strip, panels, buttons, fields, tabs, evidence, dialog, results, charts and tables through shared classes so every active page benefits without branching workflow logic.
- [ ] Preserve visually readable opaque technical surfaces and immediate verdict/error readability; add narrow-window fallback and reduced-motion handling.
- [ ] Run `npm test -- --run` and `npm run build`.

## Chunk 2: Evidence and workflows

### Task 4: Local shadcn-style evidence charts

**Files:** Modify `frontend/package.json`, `frontend/package-lock.json`; create `frontend/src/ui/evidenceChart.tsx`, `frontend/src/ui/evidenceChart.test.tsx`; modify `frontend/src/pages/analysis/HistogramPanel.tsx`, `frontend/src/pages/analyse/sections.tsx`.

- [ ] Add tests for real channel distributions, chi-square null/interpretable segments, unsupported BPCS and descriptive-only wording. Null must never be plotted as zero.
- [ ] Run focused tests; observe intended failure.
- [ ] Install Recharts; build local chart container/tooltip/legend and evidence-specific area/bar chart adapters. Keep data ordering, exact metric names and human-readable data summary; avoid animated readings.
- [ ] Use chart adapters in inspected/reference histogram, chi-square and BPCS views where they improve clarity; retain specialized image/bit-plane viewers.
- [ ] Run focused tests and build; check tooltips and stable dimensions.

### Task 5: Workflows and robustness

**Files:** Modify `frontend/src/pages/{KeysPage,HidePage,VerifyPage,TextPage,AnalysePage,AttackPage,RobustnessPanel}.tsx` as needed, `frontend/src/pages/analysis/Results.tsx`, `frontend/src/styles.css`; tests near changed workflows.

- [ ] Audit each active workflow's empty, form, busy, error, result and stale states. Add only meaningful regression tests for changed navigation/interaction semantics.
- [ ] Apply shared card and workspace classes to keys, embed, verify, text, inspect, tamper tests, and the existing robustness simulator. Place robustness in its existing owned section; do not create a new route.
- [ ] Summarize robustness transformations using actual PSNR/MSE/SSIM data with explicit unavailable handling; preserve downloads and form values.
- [ ] Run workflow tests and build; preserve file handoff, result focus and exact verdict language.

## Chunk 3: Consolidation and final proof

### Task 6: Strict cleanup with proof

**Files:** Modify `.gitignore`, `README.md`, `PRODUCT.md`, `docs/ui-library-adoption.md`; delete only confirmed obsolete tracked items.

- [ ] Produce inventory of tracked versioned documents, duplicate scripts, generated files and old runtime paths; map each reference from scripts/tests/docs.
- [ ] Preserve cryptographic v2/v3 protocol identifiers, compatibility implementations and tests. Preserve Git history and any untracked user work.
- [ ] Remove only confirmed obsolete release-era plans/docs and duplicate scripts; update current docs and gitignore for generated `build/`, `tmp/` and caches. No deletion based on filename alone.
- [ ] Run repository-wide search for obsolete release references; retain valid protocol references.

### Task 7: Verify desktop release

- [ ] Run `npm test -- --run` and `npm run build` from `frontend`.
- [ ] Run Python tests, including `tests/test_desktop.py`, and run `scripts/build-desktop.ps1` when prerequisites exist.
- [ ] Visually exercise expanded/collapsed desktop sidebar, every workflow, keyboard focus, reduced motion, long filenames, empty/error/result states, and chart null values in the packaged application when runnable.
- [ ] Review `git diff --check`, `git status --short`, and exact deleted files; record any environmental blockers without claiming unrun checks pass.

**Acceptance:** All existing routes and API/protocol contracts remain valid; all active workflows use the same controlled luminous design system; shadcn-style sidebar and chart views function with honest data and accessible keyboard behavior; obsolete release artifacts are removed only after reference proof; frontend and desktop verification pass.

## Execution record

- Baseline after `npm ci`: 82 frontend tests and production build passed. The initially installed `node_modules` lacked declared `motion/react`, so the pre-install test/build failure was environmental.
- Implemented the locally owned sidebar, light glass token system and offline font. Existing mounted pages inherit the same shell and shared styles. The new collapsed-state accessibility test failed before implementation and passed afterward.
- Added on-demand Recharts evidence views for chi-square sections, BPCS complexity and robustness PSNR. The original zoomable histogram and image/bit-plane views remain because their dense and visual data is better served by the existing specialized viewers. Tests cover zero versus null, unsupported BPCS and preserved descriptions.
- Audited tracked versioned files and search references. Removed six superseded planning/spec documents. The two similarly named benchmark scripts perform different operations and remain documented; protocol-version endpoints, code and docs remain supported. Build, tmp and caches were already excluded in `.gitignore`, and no generated output was tracked.
- Final frontend: `npm test -- --run` passed 86 tests. The desktop packaging script rebuilt the frontend and `dist/Stegloc/Stegloc.exe`; the packaged `frontend/dist/assets/` includes the lazily loaded chart chunk and local fonts. `git diff --check` reported no patch errors.
- Python: the default Windows pytest temp location denied access, causing 17 fixture setup errors; rerunning with `--basetemp="C:\Users\jwooh\AppData\Local\Temp\opencode\stegloc-pytest"` passed all 318 tests.
- Pending manual inspection: this harness has no browser/window screenshot or interaction tool. The packaged UI's appearance, keyboard focus and reduced-motion behavior need a human visual smoke pass at the target desktop size. The build still reports a 505.86 kB initial JS chunk warning; Recharts itself now loads only when a result requires it.
