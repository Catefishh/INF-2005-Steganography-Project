# Watermelon UI and Motion-Primitives Adoption Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Stegloc's clarity, consistency, and interaction quality by using Watermelon UI as a design reference and selectively adapting Motion-Primitives to the existing React/CSS frontend.

**Architecture:** Keep the current React 19, Vite, and plain CSS architecture. Watermelon UI (`https://ui.watermelon.sh/`) is a public catalog/reference and is not treated as an installable component package; use it to identify suitable dashboard patterns and document provenance. Install Motion only if selected Motion-Primitives components require it, adapt those components to existing CSS tokens, and introduce them through the shared UI layer before applying them to the primary workflows.

**Tech Stack:** React 19, TypeScript, Vite 8, CSS, Vitest, Testing Library, Motion (conditional on selected components).

---

## Chunk 1: Integration Decisions and Shared Foundation

### File Structure

- Modify: `frontend/package.json` and `frontend/package-lock.json` (or the repository's generated npm lockfile, if present) for only dependencies needed by selected components.
- Modify: `frontend/src/ui/layout.tsx` for shared interactive primitives where appropriate.
- Modify: `frontend/src/styles.css` for token-aligned component styles, focus states, and reduced-motion behavior.
- Modify: `frontend/src/main.tsx` only if a Motion provider or application-level preference setup is required.
- Test: `frontend/src/modular-ui.test.tsx` and `frontend/src/a11y.test.tsx` for shared behavior and accessibility.
- Create: `docs/ui-library-adoption.md` describing Watermelon UI's role as a reference catalog, selected examples and URLs, adapted component provenance, package requirements, and update policy.

### Task 1: Verify integration surfaces and baseline

- [ ] **Step 1: Record the existing baseline**

Run from `frontend`: `npm test -- --run`
Expected: Existing frontend tests pass before UI changes.

- [ ] **Step 2: Inspect current app-shell and shared controls**

Review `frontend/src/App.tsx`, `frontend/src/ui/layout.tsx`, `frontend/src/styles.css`, `frontend/src/modular-ui.test.tsx`, and `frontend/src/a11y.test.tsx`. Preserve routing, page composition, native form controls, and component exports unless a planned interaction needs change.

- [ ] **Step 3: Select Watermelon references and Motion-Primitives candidates**

Use Watermelon dashboard and animated-component catalog entries as design references, recording exact URLs in `docs/ui-library-adoption.md`. From Motion-Primitives, select at most three candidates that directly clarify current behavior: transition panel for route/form-result changes, disclosure/accordion for optional settings, and animated group or in-view for result/evidence arrival. Check each candidate's current source, license, dependencies, keyboard behavior, and Tailwind assumptions before selecting it. Do not assume Watermelon publishes an installable component package.

- [ ] **Step 4: Confirm a CSS-compatible implementation approach**

For each selected Motion-Primitives component, choose a minimal CSS/token adaptation or a small wrapper around its Motion behavior. Keep semantic HTML and shared class naming. Do not introduce Tailwind throughout the app solely to copy examples. Add `motion` only if a selected implementation needs it; the app already provides `Icon`.

### Task 2: Establish shared component and motion conventions

**Files:** `frontend/src/ui/layout.tsx`, `frontend/src/styles.css`, optionally `frontend/src/main.tsx`, `docs/ui-library-adoption.md`, `frontend/src/modular-ui.test.tsx`, `frontend/src/a11y.test.tsx`

- [ ] **Step 1: Add focused tests for shared interaction semantics**

Test selected shared behaviors: disclosure expanded/collapsed state and ARIA linkage, transition state preserving focus/content expectations, and reduced-motion behavior where animation is introduced. Reuse existing tests rather than snapshotting styles or duplicating implementation details.

- [ ] **Step 2: Run focused tests to establish expected failures**

Run from `frontend`: `npm test -- --run src/modular-ui.test.tsx src/a11y.test.tsx`
Expected: New assertions fail for behavior not yet implemented; existing assertions continue to pass.

- [ ] **Step 3: Implement shared, token-aligned primitives**

Adapt only selected components into `frontend/src/ui/` or the existing `layout.tsx` boundary. Preserve native button semantics, accessible names, focus behavior, and current CSS variables. Ensure animations are short, state-driven, and non-blocking. Add a `prefers-reduced-motion: reduce` path. Do not delay access to controls or change verdict color/meaning through animation.

- [ ] **Step 4: Document install and use instructions**

In `docs/ui-library-adoption.md`, explain that Watermelon UI is used for reference and discovery, with no Watermelon runtime dependency. Document exact adapted Motion-Primitives examples, links, licenses/provenance, any `motion` dependency, and the local CSS adaptation approach. Include install, test, build, and desktop asset build commands.

- [ ] **Step 5: Verify the shared layer**

Run from `frontend`: `npm test -- --run src/modular-ui.test.tsx src/a11y.test.tsx`
Expected: PASS, including reduced-motion and keyboard/accessibility assertions.

## Chunk 2: Primary Workflow Adoption

### Task 3: Improve app-shell navigation and workflow orientation

**Files:** `frontend/src/App.tsx`, `frontend/src/styles.css`; tests in `frontend/src/pages.test.tsx` and `frontend/src/a11y.test.tsx`.

- [ ] **Step 1: Add behavior-focused app-shell tests**

Verify route navigation retains `aria-current`, menu controls preserve expanded state and usable focus, and transitions do not leave hidden pages focusable or announce stale page content. Include a reduced-motion case if route transitions animate.

- [ ] **Step 2: Run focused tests**

Run from `frontend`: `npm test -- --run src/pages.test.tsx src/a11y.test.tsx`
Expected: Existing app-shell behavior passes; new requirements fail until implemented.

- [ ] **Step 3: Apply Watermelon-informed hierarchy and restrained transitions**

Refine sidebar/topbar hierarchy and state visibility using selected Watermelon references, retaining Stegloc's cool surfaces, slate navigation, teal/coral/amber status colors, and responsive layout. Apply a Motion-Primitives-derived transition only to route or form/result changes where it improves orientation. Respect reduced motion and avoid decorative looping effects.

- [ ] **Step 4: Verify navigation and accessibility**

Run from `frontend`: `npm test -- --run src/pages.test.tsx src/a11y.test.tsx`
Expected: PASS with navigation, focus, current-page semantics, and reduced-motion behavior intact.

### Task 4: Polish embed and verify interactions

**Files:** `frontend/src/pages/HidePage.tsx`, `frontend/src/pages/embed/Options.tsx`, `frontend/src/pages/embed/Result.tsx`, `frontend/src/pages/VerifyPage.tsx`, `frontend/src/pages/verify/Result.tsx` as required; `frontend/src/styles.css`; tests in `frontend/src/pages.test.tsx` and relevant workflow tests.

- [ ] **Step 1: Add tests for high-value interaction states**

Cover selected optional-setting disclosure, processing-to-result transition, error visibility, and the fact that verification result wording/state is immediately available and not obscured by animation. Preserve file selection and workflow state across transitions.

- [ ] **Step 2: Run relevant tests and confirm the gap**

Run from `frontend`: `npm test -- --run src/pages.test.tsx src/api/jobs.test.ts`
Expected: Baseline tests pass and new interaction assertions identify missing behavior.

- [ ] **Step 3: Apply adapted interactions to embed and verify**

Use shared disclosure/transition primitives for optional configuration and form/result transitions. Keep controls operable, announce errors immediately, and do not animate or color-transform authenticity verdict semantics. Maintain API calls, route behavior, and submit/disable rules.

- [ ] **Step 4: Run focused workflow tests**

Run from `frontend`: `npm test -- --run src/pages.test.tsx src/api/jobs.test.ts`
Expected: PASS; embed and verify behavior and API contracts remain intact.

### Task 5: Improve analysis evidence interaction

**Files:** `frontend/src/pages/AnalysePage.tsx`, `frontend/src/pages/analyse/sections.tsx`, or relevant files under `frontend/src/pages/analysis/`; `frontend/src/styles.css`; tests in `frontend/src/pages/analyse/AnalysePage.test.tsx`, `frontend/src/pages/analyse/model.test.ts`, and `frontend/src/a11y.test.tsx`.

- [ ] **Step 1: Add tests for evidence exploration and honest status presentation**

Ensure evidence sections can be expanded with keyboard controls, their state is accessible, and motion preference does not alter calculated analysis data or imply that descriptive statistics prove hidden content.

- [ ] **Step 2: Run focused analysis tests**

Run from `frontend`: `npm test -- --run src/pages/analyse/AnalysePage.test.tsx src/pages/analyse/model.test.ts src/a11y.test.tsx`
Expected: Existing analysis behavior passes; any new shared-interaction expectations fail before implementation.

- [ ] **Step 3: Apply consistent disclosure and evidence transitions**

Use shared primitives for collapsible evidence/settings and restrained result reveal. Keep charts, image comparisons, and evidence labels readable and stable. Do not animate chart values as if data is streaming unless the underlying data is changing. Honor reduced motion.

- [ ] **Step 4: Verify the analysis surface**

Run from `frontend`: `npm test -- --run src/pages/analyse/AnalysePage.test.tsx src/pages/analyse/model.test.ts src/a11y.test.tsx`
Expected: PASS with model output and accessibility contracts unchanged.

## Chunk 3: Product Verification and Handoff

### Task 6: Verify dependency, build, packaging, and visual consistency

**Files:** Modify only if needed: `frontend/package.json`, npm lockfile, `frontend/src/styles.css`, and `docs/ui-library-adoption.md`.

- [ ] **Step 1: Run all frontend tests**

Run from `frontend`: `npm test -- --run`
Expected: PASS across all frontend tests.

- [ ] **Step 2: Run production frontend build**

Run from `frontend`: `npm run build`
Expected: TypeScript check and Vite production build succeed.

- [ ] **Step 3: Verify desktop packaging integration**

Run from repository root: `.venv\Scripts\python.exe -m pytest tests/test_desktop.py -q`

When prepared Windows packaging dependencies are present, run from repository root in PowerShell: `scripts\build-desktop.ps1`

Expected: Desktop integration tests pass and the packaging script includes generated frontend assets. Do not alter packaging behavior unless verification exposes an asset inclusion issue.

- [ ] **Step 4: Review consistency and runtime cost**

Inspect the diff for duplicate motion dependencies, unused copied components, CSS token drift, layout shifts, and animations that add no information. Confirm animations have reduced-motion handling, buttons remain usable during transitions, and tests/build produce no console errors. Record installed dependencies and component sources in `docs/ui-library-adoption.md`.

- [ ] **Step 5: Run a browser smoke pass**

Run the API and Vite development servers as documented in `README.md`; exercise app shell, embed, verify, and inspect at desktop and narrow viewport widths. Check keyboard-only navigation and emulated reduced motion. Confirm panels do not overlap, text does not clip, and status/result hierarchy remains understandable.

- [ ] **Step 6: Summarize adoption boundaries and verification**

Update `docs/ui-library-adoption.md` with completed component choices, install/use commands, test/build results, and intentionally deferred catalog elements. Keep Watermelon UI documented as a reference platform and Motion-Primitives components as local adapted code unless upstream publishes a supported package appropriate for this app.

## Acceptance Criteria

- Watermelon UI's role, selected reference URLs, and reuse/provenance policy are documented; no unsupported Watermelon package is installed.
- Motion-Primitives is adopted selectively with only dependencies required by chosen components; Tailwind is not introduced for this rollout.
- App shell, embed, verify, and inspect workflows share consistent interaction and visual conventions.
- Keyboard use, accessible state announcements, reduced-motion preferences, and security-verdict semantics remain correct.
- Existing API, routing, analysis, frontend test, production build, and desktop packaging contracts continue to pass.
