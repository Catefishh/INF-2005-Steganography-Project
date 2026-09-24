# Stegloc UI/UX Overhaul and v4 Consolidation Design

## Status

Approved design direction. This document is the basis for the implementation plan.

## Goal

Overhaul Stegloc's full application UI/UX into one cohesive desktop steganography studio based on the supplied `DESIGN.md` and reference HTML. Adopt the shadcn sidebar and chart patterns locally, retain Watermelon UI as a visual reference, continue using Motion for interaction flow, and consolidate the repository around the current v4 implementation.

The result must preserve existing application behavior while making the product feel like one finished release rather than a collection of v1, v2, v3, and v4 iterations.

## Decisions

- Scope covers the full application: shared shell, all workflows, charts, states, responsive protections, documentation, and repository cleanup.
- The current v4 behavior and architecture are the canonical baseline.
- Navigation is workflow-first: Keys, Hide, Verify, Text, Analyse, Attacks, and Robustness where the existing route or workflow integration supports it.
- Desktop packaged-app use is the primary layout target. Narrow windows must remain usable but are not equal-priority responsive targets.
- Use a controlled luminous-glass system. Glass is strongest in the shell, sidebar, headers, dialogs, selected states, and primary workspace framing. Dense evidence and technical form surfaces remain more opaque for readability.
- Preserve all existing route URLs, API contracts, form behavior, file handoff behavior, security semantics, result wording, and test contracts.
- Use local shadcn-style components adapted to the existing React/Vite/TypeScript/plain-CSS architecture. Do not introduce a full Tailwind or shadcn configuration solely to copy examples.
- Use the shadcn sidebar pattern from `https://ui.shadcn.com/blocks/sidebar` and chart patterns from `https://ui.shadcn.com/charts/area` as source and interaction references.
- Continue using `motion/react` for restrained state-driven transitions and retain Watermelon UI as a design/reference source rather than a runtime dependency.
- Analysis evidence is the priority for charts. Operational dashboard analytics are out of scope for this overhaul.
- Cleanup follows a strict production policy: remove obsolete versioned runtime code/docs, generated build outputs, temporary artifacts, caches, duplicate scripts, and stale modules after reference checks and verification.

## Existing Context

The frontend is a React 19, Vite, TypeScript, plain-CSS application. The current shell is in `frontend/src/App.tsx`, shared UI behavior is in `frontend/src/ui/layout.tsx` and `frontend/src/components.tsx`, and styling is centralized in `frontend/src/styles.css`. Motion is already installed and used for route, disclosure, result, and working-file transitions.

Current workflows include keys, embed/hide, verify/extract, text steganography, file analysis, attack testing, and robustness-related UI. Analysis data already exposes histograms, bit planes, chi-square measurements, RS/BPCS metrics, comparisons, PSNR/MSE/SSIM, and timing information. The desktop packaging path and its tests must remain valid.

## Architecture

### Application shell

Replace the current custom rail presentation with local shadcn-style sidebar primitives while preserving the existing route and state ownership model.

The shell will contain:

- `SidebarProvider` state for expanded and collapsed desktop modes.
- A persistent left sidebar with Stegloc branding, key readiness, workflow groups, active route state, and supporting technical status.
- `SidebarInset` content with a consistent top context header, breadcrumb or workflow context, page heading, and working-file strip.
- `SidebarTrigger` for keyboard-accessible collapse/expand behavior.
- Local tooltip behavior for icon-only collapsed navigation.
- Existing focus movement to the current page heading after navigation.

The current canonical route paths remain stable: `/keys`, `/embed`, `/verify`, `/text`, `/inspect`, and `/tamper-tests`, including `/embed/result` and `/verify/result`. Robustness will be exposed as an owned subsection within the existing workflow routes; the implementation plan must establish its current integration before relocating its presentation.

Inactive screens continue to be removed from keyboard and accessibility navigation with the existing hidden-page behavior. The working file, digest, replace, clear, and handoff behavior remain application-level state.

### Local UI component layer

Add focused local primitives under the existing UI/component ownership boundaries as needed:

- Sidebar, provider, inset, trigger, menu, menu item, and tooltip behavior.
- Button, badge, card, input, textarea, select, switch, tabs, progress, dialog, and separator styles where existing controls need a common visual contract.
- Chart container, chart tooltip, legend, and color configuration wrappers for Recharts-based evidence views.

Existing semantic helpers remain the behavior owners and receive the new visual treatment rather than being duplicated:

- `Panel`
- `ActionBar`
- `Disclosure`
- `Reveal`
- `Outcome`
- `StaleBanner`
- `EmptyState`
- `ErrorNote`
- `ConfirmDialog`

## Visual System

### Tokens

Define CSS variables from the supplied Luminous Spatial Glass specification, including surface tiers, primary and secondary cyan, tertiary indigo, slate text, outlines, and semantic success, warning, and error roles. Use Plus Jakarta Sans with a system fallback for packaged/offline operation.

Use the supplied type hierarchy as the basis for page headings, panel headings, labels, body text, and technical metadata. Display type must remain reserved for true page-level headings; compact panels use the smaller headline and label roles.

### Surfaces and elevation

- Use a static atmospheric canvas with restrained radial lighting.
- Use translucent glass for the application shell, sidebar, header, working-file strip, dialogs, selected navigation, and major workspace framing.
- Use higher-opacity surfaces for forms, evidence tables, chart plotting areas, technical metrics, and dense result content.
- Use hairline borders, specular inner highlights, controlled shadows, and consistent radii.
- Use pill-shaped buttons, tabs, switches, and badges where the control semantics support it. Keep technical panels compact and structured rather than turning every surface into a floating card.
- Avoid decorative animated background blobs, excessive blur behind text, and effects that reduce technical readability.

### Motion

Continue using `motion/react` and `MotionConfig reducedMotion="user"`. Motion is appropriate for:

- Page and route entry.
- Sidebar expansion/collapse orientation.
- Dialog entry and exit.
- Disclosure chevron and body orientation.
- Working-file strip arrival and removal.
- Result surface presentation.

Animations must be short, state-driven, and non-blocking. Security verdicts, calculated values, evidence labels, and limitations must appear immediately and must not be animated in a way that implies unsupported certainty. Every new motion path needs a reduced-motion behavior.

## Workflow Design

### Keys

Present key generation, import, fingerprints, and readiness as a guided setup surface. Keep the existing vault state and key contracts while improving hierarchy and explaining readiness through concise status surfaces.

### Hide / Embed & Sign

Organize carrier selection, payload selection, algorithm/options, validation, and submission into a clear desktop workspace. Preserve the current form state, file handoff, API calls, disabled states, route-driven result transition, and output actions.

### Verify / Extract & Verify

Give the verification outcome an immediate high-contrast outcome surface, followed by verification stages, trust information, payload details, hashes, and downloadable results. Preserve exact verdict names, trust semantics, live announcements, and stale-result behavior.

### Text Steganography

Retain acrostic, whitespace, and zero-width modes. Present mode selection using a compact accessible tab or segmented control while preserving current text workflow behavior and result handling.

### Analyse / Inspect a file

Make this the primary chart-rich workspace. Organize evidence using stable tabs or sections for:

- Histograms and channel distributions.
- Bit-plane views.
- Chi-square segment values and limitations.
- RS/BPCS metrics and comparisons.
- Original/stego comparisons and difference views.
- Timing information.

Charts must distinguish descriptive evidence from proof of hidden content. Null, unsupported, or insufficient data must produce an explicit empty or unavailable state rather than an invented zero.

### Attack Testing / Tamper tests

Organize the configuration surface and result matrix separately. Each scenario should show the operation, expected and actual verdict, status, elapsed time, evidence where available, and artifact download action. Preserve scenario semantics and API behavior.

### Robustness

Finish the existing image robustness simulator as a coherent workflow surface or clearly owned analysis subsection based on existing routing. Group transformation controls with a chartable result summary and scenario result cards. Preserve baseline verdicts, scenario metrics, artifact downloads, and error/progress states.

## Charts

Introduce a local shadcn-style chart layer using Recharts only where the existing data benefits from it. The chart layer must provide shared color tokens, legends, tooltips, accessible labels, empty states, and stable dimensions.

Planned chart mappings:

- Histogram or compact line views for channel and bit-plane distributions.
- Area or line views for ordered chi-square segment p-values, with descriptive-only labeling and threshold explanation.
- Bar or radial views for BPCS complexity and channel comparisons.
- Compact comparison charts for PSNR, MSE, SSIM, and robustness scenario metrics.
- Existing specialized SVG charts may remain where they communicate the evidence more clearly; migration is based on behavior and clarity rather than replacing every chart mechanically.

## Repository Consolidation

Cleanup is a gated workstream after the functional UI migration is stable.

1. Inventory every v1/v2/v3/v4 marker, stale module, script, generated output, temporary artifact, cache, and documentation reference.
2. Classify each item as canonical runtime, required build/package input, current documentation, historical/obsolete, generated, or temporary.
3. Verify references using repository-wide search, TypeScript imports, npm scripts, package metadata, packaging specs, build scripts, README instructions, and test fixtures.
4. Keep only the v4-derived implementation as the canonical source.
5. Remove obsolete versioned runtime files, stale modules, duplicate scripts, generated `build/` and `tmp/` outputs, caches, and superseded docs confirmed as non-current.
6. Update README, product docs, build/package instructions, and UI adoption documentation to describe one supported release line.
7. Remove user-facing v1/v2/v3/v4 labels or replace them with a single current release identity.
8. Add or update ignore rules for generated outputs and temporary files where appropriate.
9. Re-run the full verification suite and search for stale version references after cleanup.

Deletion is never based on a filename alone. If a removed artifact is referenced by a valid build or test, update the valid reference or restore only the required current artifact.

Release versions and protocol versions are distinct. The current product supports versioned cryptographic and text formats. Keep their protocol identifiers, serializers, decoders, API paths, compatibility tests, and documentation wherever required by current behavior. Consolidating the product identity does not authorize removing support for those formats. Historical Git commits also remain intact. Before deleting untracked temporary files, inspect their ownership and contents for unique user work.

## Accessibility and Failure Handling

- Preserve semantic headings and page heading focus after navigation.
- Preserve `aria-current`, live result and error announcements, disclosure `aria-expanded`/`aria-controls`, dialog focus trapping, and keyboard navigation.
- Provide accessible names and tooltips for icon-only controls in collapsed navigation and chart actions.
- Ensure chart data has meaningful labels and an explicit unavailable state for null or unsupported values.
- Preserve reduced-motion support for all newly animated states.
- Keep errors visible without hiding the form or replacing useful context.
- Preserve exact security verdict meaning and avoid changing colors or wording in ways that alter interpretation.

## Verification and Acceptance

### Frontend

- `npm ci`
- `npm test -- --run`
- `npm run build`

Focused tests must cover sidebar active/collapsed state, tooltips, chart empty/populated data, route and workflow preservation, file handoff, key readiness, result semantics, stale results, dialogs, disclosures, keyboard focus, and reduced motion.

### Backend and desktop

- Run the relevant Python API and desktop test suite.
- Run the desktop packaging test and packaged build using the repository's documented commands.
- Confirm generated frontend assets are included in the packaged application.

### Desktop review

At the intended desktop window size, verify sidebar modes, dense analysis layouts, chart tooltips, long filenames, large evidence sections, dialogs, loading states, errors, results, and downloads. Confirm there is no panel overlap, clipped text, inaccessible control, or unbounded horizontal scrolling.

### Cleanup gate

After cleanup, confirm:

- No active source, package metadata, scripts, or user-facing docs retain obsolete release references. Required protocol version references remain documented and functional.
- Required v4 behavior remains available through the existing routes.
- Generated outputs and temporary artifacts are absent or ignored.
- Frontend tests and build pass.
- Backend/API and desktop tests pass.
- Desktop packaging succeeds.

## Delivery Sequence

1. Convert this design into a file-level implementation plan with a cleanup inventory strategy.
2. Establish baseline frontend, backend, and desktop verification results.
3. Implement the shared shell, local shadcn-style primitives, tokens, and motion conventions.
4. Migrate workflows one group at a time while preserving route and API contracts.
5. Implement and verify analysis and robustness charts.
6. Run the full test, build, packaging, accessibility, and desktop review gates.
7. Execute the strict repository cleanup from the verified inventory.
8. Re-run all checks and update current documentation for the consolidated release.
