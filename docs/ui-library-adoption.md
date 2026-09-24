# UI reference and motion adoption

## V4 update

The v4 interface uses Watermelon UI's [dashboard gallery](https://ui.watermelon.sh/dashboards) as a layout reference for its navigation, compact status surfaces, and evidence cards. The dark glass styling is implemented in local CSS; no Watermelon code or runtime package is copied. [Motion for React](https://motion.dev/docs/react) is installed for navigation headings, panel entry, disclosures, the working-file strip, and arriving results. `MotionConfig reducedMotion="user"` follows the operating-system preference. Hash values, verdicts, and calculated metrics remain static. The earlier CSS-only decisions below describe the v3 release.

The v4 browser pass covered the 639 px narrow layout, including its mobile menu and evidence surfaces. A stretched grid row initially left excessive space below the mobile rail; `align-content: start` corrected it. Keyboard focus and reduced-motion rules are retained, while the packaged Windows build includes pinned FFmpeg and ffprobe binaries plus redistribution notices.

Stegloc keeps React, Vite, and plain CSS. [Watermelon UI dashboards](https://ui.watermelon.sh/dashboards) informed the clearer section and role line above each screen and the distinction between current navigation and supporting status. Its [animated components catalog](https://ui.watermelon.sh/animated-components) was used for discovery of restrained state changes. These are catalog-level references; no Watermelon component source was copied, and Watermelon is not a runtime dependency. The existing cool surfaces, slate rail, and teal/coral/amber meanings remain Stegloc's own design.

Two [Motion-Primitives](https://motion-primitives.com/docs) patterns were adapted locally:

| Reference | Local use | Adaptation |
| --- | --- | --- |
| [Disclosure](https://motion-primitives.com/docs/disclosure) | Shared `Disclosure` in `frontend/src/ui/layout.tsx`; embed and verification options, BPCS settings, analysis timings | Existing semantic button, `aria-expanded`, `aria-controls`, and `hidden` body remain. CSS animates only an opened body. Closing hides controls immediately. |
| [Animated Group](https://motion-primitives.com/docs/animated-group) | Shared `Reveal` in `frontend/src/ui/layout.tsx`; active screens and embed/inspect results | A single short CSS arrival indicates newly shown content. Content mounts immediately, can receive focus immediately, and keeps its normal DOM order. No stagger or delayed verdict. |

Motion-Primitives' [source repository](https://github.com/ibelick/motion-primitives) is [MIT licensed](https://github.com/ibelick/motion-primitives/blob/main/LICENCE.md). Its published examples use Motion and Tailwind. The local adaptations use neither source code nor Tailwind classes; CSS and existing tokens cover these two behaviors, so `motion` is not installed. The only copied idea is the interaction pattern. If a future component needs Motion's interruption or layout sequencing, review the upstream source, license, dependencies, keyboard behavior, and reduced-motion path again before adding it.

The CSS in `frontend/src/styles.css` limits arrival to 180 ms and disclosure to 150 ms. It disables both under `prefers-reduced-motion: reduce`; the brand wave keeps its existing animation unless reduced motion is requested. Routing keeps inactive screens under `hidden`, which removes their controls from keyboard and accessibility navigation while preserving form state. Navigation moves focus to the new page heading. Result headings retain their own immediate focus and live announcement; verdict colors, wording, and analysis values do not animate.

## Install and verify

From `frontend`:

```powershell
npm ci
npm test -- --run
npm run build
```

From the repository root, with the documented Python environment:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_desktop.py -q
.\scripts\build-desktop.ps1
```

For a browser smoke pass, start the API and Vite servers with the commands in `README.md`, then visit the Vite URL. Check the shell, Embed & Sign, Extract & Verify, and Inspect a file at desktop and narrow widths, with keyboard navigation and reduced motion enabled.

The Watermelon catalog's full dashboard templates, Motion-Primitives transition panels, in-view effects, and animated chart values are deferred. They would add complexity or suggest changing evidence when Stegloc's data is static. Revisit these references only for a concrete workflow need; keep upstream URLs and dependency decisions in this file when doing so.

## Verification on 2026-09-23

- Frontend: `npm test -- --run` passed 77 tests; `npm run build` passed.
- Desktop: `tests/test_desktop.py` passed 9 tests; `scripts/build-desktop.ps1` built `dist/Stegloc/Stegloc.exe` with the generated frontend assets.
- Browser: the narrow-width app shell, mobile menu, Embed & Sign, Extract & Verify, and Inspect a file were exercised at `127.0.0.1:5173`. The current page heading received focus after navigation, and optional settings opened with accessible expanded state. Desktop-width and emulated reduced-motion browser checks were unavailable in the in-app browser; the CSS media query and desktop layout were reviewed in source.
