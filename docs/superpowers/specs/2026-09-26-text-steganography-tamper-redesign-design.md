# Text Steganography and Tamper Tests Redesign

## Goal

Overhaul the text steganography and text tamper-test UI so the workflow is understandable, visually coherent, and less complicated to operate during demonstrations. The redesign will use two focused tabs with shared workspace state:

- `Protect & verify`, selected by default.
- `Tamper tests`, available for the same text workspace and for imported protected text.

The existing text protocols, API contracts, backend jobs, artifact formats, and test semantics remain unchanged.

## Users and workflow

The primary user starts with a message and creates a protected text carrier. The default flow is:

1. Choose a text hiding method.
2. Enter the message and visible carrier text where applicable.
3. Estimate capacity if needed.
4. Generate or provide sender keys.
5. Protect the text.
6. Review or edit the carrier, then verify it with recovery material and the public key.
7. Move to `Tamper tests` to run the prepared text suite.

Recipients can import an existing carrier, recovery file, recovery code, and public key without going through protection first.

## Information architecture

`TextPage` becomes the shared workspace coordinator. It owns the selected tab and shared text state, while focused child components render each workflow.

### Protect & verify tab

The tab is organized into three stages:

1. **Create the protected text**
   - Message to hide.
   - Method selector for acrostic initials, trailing whitespace, or zero-width characters.
   - Visible cover text, generated automatically for acrostic mode.
   - Import control for editable visible text where applicable.
   - Capacity estimate action and result.
   - Primary `Protect text` action.

2. **Sender materials**
   - Key password and key generation in a secondary disclosure.
   - PEM fields shown when generated or manually edited.
   - Download controls grouped with the corresponding key materials.
   - Protection result containing carrier, recovery artifact, recovery code, and frame size.

3. **Verify the carrier**
   - Carrier editor/import control.
   - Recovery file, recovery code, and public key.
   - Primary `Extract & verify` action.
   - Verification result showing the authenticated message and whether visible text is authenticated.

### Tamper tests tab

Before execution, show:

- A compact summary of the selected carrier, recovery file, recovery code, and public key.
- A checklist grouped into baseline, credential changes, and carrier edits.
- Method-specific cases for acrostic, whitespace, and zero-width carriers.
- Clearly marked unavailable cases with a reason.
- One primary `Run text tamper tests` action.

After execution, show:

- Summary counts for passed, unexpected, inconclusive, and unavailable cases.
- Compact result rows with case name, change, expected result, observed verdict, and status.
- Expandable details containing the existing summary, elapsed time, reached stages, payload hash evidence, and artifact download when available.
- Rerun, cancel, and evidence ZIP download actions as appropriate.

## Character evidence

Replace the current native `<details>` disclosure titled `Before and after text characters` with a designed evidence component named `Character changes`.

The component will provide:

- An explicit button with hover, focus, selected, and disabled states.
- A segmented view for `Visible text` and `Encoded carrier`.
- Monospace text with stable layout and line numbers where practical.
- Visual tokens for trailing spaces, tabs, and zero-width code points.
- A compact summary of detected changes and method-specific diagnostics.
- A short legend explaining the symbols used in the rendering.

The evidence panel is explanatory only. It does not alter the carrier and does not claim that visible wording is authenticated.

## Shared state and transitions

The workspace state includes:

- Method.
- Message and visible text.
- Carrier text and filename context.
- Recovery file and recovery code.
- Public and private key PEM values.
- Password.
- Protection, verification, and tamper results.
- Tamper job id, phase, progress, and errors.

Behavior rules:

- Protection populates carrier, recovery file, recovery code, and any available public key.
- Switching tabs preserves all workspace values.
- Importing a carrier, recovery file, or key updates the shared state regardless of the active tab.
- Editing the carrier or verification credentials invalidates current result freshness and displays a rerun affordance.
- Switching methods clears method-specific preview and diagnostic state without silently deleting carrier or cryptographic materials.
- Missing required inputs are shown near their controls and disable the relevant primary action.
- Errors preserve user-entered values and uploaded files.
- Unavailable tamper cases remain visible and are not counted as failures.

## Component boundaries

Expected frontend boundaries:

- `TextPage`: shared workspace state, tab selection, API orchestration, and handoff.
- `ProtectVerifyPanel`: protection, sender materials, carrier editing, and verification presentation.
- `TextTamperPanel`: pre-run checklist, job lifecycle, result summary, and result rows.
- `CharacterChanges`: reusable text-character evidence visualization.
- Existing API modules and backend job endpoints: unchanged unless a narrowly scoped adapter is required for the UI.

The existing media tamper workflow remains available. The text experience is a dedicated view within the tamper-test area and does not change media scenario behavior.

## Visual and interaction direction

Use the existing Luminous Spatial Glass visual language: pale cool canvas, translucent navigation, opaque technical evidence, cyan primary controls, slate type, and restrained semantic colors. Text controls should be dense enough for desktop demonstrations but remain readable on narrow screens.

Use designed buttons and disclosure controls instead of browser-default presentation. Use familiar icons where the existing icon system provides them. Keep primary actions singular and obvious within each stage. Avoid nested cards; use panels for workflow stages and framed evidence only where it provides real inspection value.

## Error and edge-case handling

- Empty message, missing carrier text, missing keys, missing recovery material, and invalid codes retain inline validation behavior.
- A carrier edited after protection is treated as user-edited text and can be exported only when method constraints remain valid.
- Acrostic line count or initials changes remain visibly flagged before export or verification.
- Generated artifact expiration continues to surface as an actionable error without clearing local text.
- Tamper polling retains cancellation and failed-job handling.
- Stale tamper results identify which inputs changed and provide a rerun action.

## Validation

Add or update focused frontend tests for:

- Protect-first flow and generated acrostic text.
- Tab switching without loss of shared state.
- Importing carrier, recovery, and public key materials.
- Character changes control and method-specific rendering.
- Stale state after carrier or credential edits.
- Tamper checklist groups and unavailable cases.
- Tamper progress, cancellation, results, details, downloads, and errors.
- Keyboard-accessible controls and responsive layout assumptions.

Run the relevant frontend unit tests and the existing project test suite before completion.

## Non-goals

- Changing text steganography protocols or artifact formats.
- Adding user-selectable individual tamper mutations.
- Reworking media tamper-test behavior.
- Replacing existing API endpoints or job polling with a new backend model.
