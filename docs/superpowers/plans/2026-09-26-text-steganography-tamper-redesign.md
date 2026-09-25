# Text Steganography and Tamper Tests Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the complicated text steganography and tamper-test UI with a shared workspace containing focused `Protect & verify` and `Tamper tests` tabs, including a designed character-evidence control.

**Architecture:** Keep existing API endpoints, protocol formats, job polling, and scenario semantics. Refactor the text page into a shared state coordinator with focused protection/verification and tamper-test panels; extract character rendering and tamper checklist/result presentation into small components.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing project components and CSS design tokens.

---

## Chunk 1: Shared workspace and protection tab

### Task 1: Add shared text workspace types and tab shell

**Files:**
- Create: `frontend/src/pages/text/workspace.ts`
- Modify: `frontend/src/pages/TextPage.tsx`
- Test: `frontend/src/pages/TextPage.test.tsx`

- [ ] Define a shared workspace shape for method, message, visible text, carrier, recovery, recovery code, keys, protection/verification results, tamper state, and errors.
- [ ] Add `Protect & verify` / `Tamper tests` tab controls with accessible tab semantics and protect-first default.
- [ ] Move existing protection state and API orchestration into the shared coordinator without changing request payloads.
- [ ] Preserve generated acrostic behavior and automatic recovery artifact loading.
- [ ] Add tests for the default tab, generated acrostic carrier, and tab switching without state loss.
- [ ] Run `npm test -- --run src/pages/TextPage.test.tsx` from `frontend` and confirm the focused tests pass.

### Task 2: Extract the protect and verify presentation

**Files:**
- Create: `frontend/src/pages/text/ProtectVerifyPanel.tsx`
- Modify: `frontend/src/pages/TextPage.tsx`
- Modify: `frontend/src/pages/text/CarrierForm.tsx`
- Modify: `frontend/src/pages/text/Results.tsx`
- Test: `frontend/src/pages/TextPage.test.tsx`

- [ ] Render the three workflow stages: create protected text, sender materials, and verify carrier.
- [ ] Put password/key generation and PEM editing into a secondary disclosure while keeping generated values functional.
- [ ] Keep import, download, estimate, protect, and verify actions wired to existing callbacks.
- [ ] Add explicit stale-result state when carrier or verification inputs change.
- [ ] Ensure required fields and primary action labels are clear and responsive.
- [ ] Update focused tests for imported carrier/recovery/key material and verification results.
- [ ] Run the focused text tests and fix any regressions before continuing.

## Chunk 2: Character evidence and tamper tab

### Task 3: Build the Character changes evidence component

**Files:**
- Create: `frontend/src/pages/text/CharacterChanges.tsx`
- Modify: `frontend/src/pages/TextPage.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/pages/TextPage.test.tsx`

- [ ] Create an explicit accessible toggle/button for the evidence panel.
- [ ] Add `Visible text` and `Encoded carrier` segmented views.
- [ ] Render stable monospace content with visible markers for spaces, tabs, and zero-width code points.
- [ ] Add summary counts and a concise legend explaining marker meanings.
- [ ] Preserve the distinction that visible wording is not authenticated.
- [ ] Add tests for opening the control and method-specific marker output.
- [ ] Run the focused tests and inspect CSS for desktop and narrow viewport overflow.

### Task 4: Extract the text tamper-test panel

**Files:**
- Create: `frontend/src/pages/text/TextTamperPanel.tsx`
- Modify: `frontend/src/pages/TextShowcase.tsx`
- Modify: `frontend/src/pages/AttackPage.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/pages/TextPage.test.tsx`
- Test: `frontend/src/pages.test.tsx`

- [ ] Reuse existing `/api/v4/jobs/text-showcase` polling and evidence ZIP behavior.
- [ ] Show shared workspace readiness and import controls without requiring duplicate setup.
- [ ] Render pre-run checklist groups for baseline, credential changes, and carrier edits.
- [ ] Mark method-inapplicable cases unavailable with reasons.
- [ ] Render post-run summary counts and compact rows with expandable details, downloads, cancel, and rerun actions.
- [ ] Preserve media tamper-test behavior and the existing `TextShowcase` handoff from `AttackPage`.
- [ ] Add tests for checklist grouping, unavailable cases, progress/results, and shared inputs.
- [ ] Run `npm test -- --run src/pages/TextPage.test.tsx src/pages.test.tsx` from `frontend`.

## Chunk 3: Styling, accessibility, and regression checks

### Task 5: Apply the text workflow visual system

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/pages/text/CarrierForm.tsx`
- Modify: `frontend/src/pages/text/Results.tsx`
- Modify: `frontend/src/pages/text/CharacterChanges.tsx`
- Modify: `frontend/src/pages/text/TextTamperPanel.tsx`

- [ ] Add styles for tabs, staged workflow sections, evidence controls, marker legends, checklist groups, result rows, and summary metrics.
- [ ] Keep buttons, focus rings, labels, and status colors consistent with existing Luminous Spatial Glass styles.
- [ ] Avoid nested cards and browser-default disclosure styling.
- [ ] Ensure long filenames, PEM values, carrier text, and result details do not overflow their containers.
- [ ] Add responsive rules for one-column narrow layouts.
- [ ] Run the accessibility tests and correct semantic/name/keyboard failures.

### Task 6: Full verification

**Files:**
- No new files unless verification exposes a focused regression.

- [ ] Run `npm test -- --run` from `frontend`.
- [ ] Run the relevant Python tests covering text workflows and v4 jobs.
- [ ] Run `git diff --check`.
- [ ] Review `git status --short` and ensure unrelated pre-existing changes remain untouched.
- [ ] Summarize test results and any remaining limitations.
