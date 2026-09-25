# UI libraries and interaction patterns

Stegloc is a React 19 / Vite desktop-first app with locally owned CSS. The supplied Luminous Spatial Glass design provides the light canvas, typography, contrast and elevation rules. Translucent glass frames navigation and the workspace; forms, charts and evidence remain on high-opacity surfaces.

## Component provenance

| Source | Local adoption | Dependency |
| --- | --- | --- |
| [shadcn sidebar blocks](https://ui.shadcn.com/blocks/sidebar) | `frontend/src/ui/sidebar.tsx` provides provider, sidebar, inset, trigger and menu composition, adapted to the existing History API and plain CSS | Local React components; no Tailwind or shadcn CLI |
| [shadcn area charts](https://ui.shadcn.com/charts/area) | `frontend/src/ui/evidenceChart.tsx` wraps Recharts for chi-square segments and BPCS complexity | `recharts` |
| [Watermelon UI dashboards](https://ui.watermelon.sh/dashboards) | Visual reference for workflow hierarchy, status surfaces and evidence cards | No Watermelon runtime or copied component source |
| [Motion for React](https://motion.dev/docs/react) | Page and result entry, sidebar, disclosure and working-file transitions | `motion` |
| [Plus Jakarta Sans](https://fontsource.org/fonts/plus-jakarta-sans) | Bundled Latin 400–700 weights, with local system fallbacks | `@fontsource/plus-jakarta-sans` |

The original interactive ChartViewer remains for high-density histograms and image evidence. Its pop-out now opens a dedicated authenticated pywebview window (or a browser tab), rendered by `frontend/src/ui/GraphWindow.tsx` at `/graph/<id>`. Only typed graph measurements move between windows via a same-origin, session-only channel; graph data is not stored on the server. The sidebar uses a more transparent frosted plate with opaque active navigation and an opaque fallback without backdrop-filter support.

Recharts is loaded on demand through `frontend/src/ui/lazyEvidenceChart.tsx` when measured results first appear. Area and bar charts plot measured values only. Null and uninterpretable measurements read **Unavailable**, not zero. Accessible compact tables present the same values without chart interactions; long tables open on demand. Charts do not animate computed readings or claim to establish embedding or authenticity.

`MotionConfig reducedMotion="user"` follows system preferences. CSS arrival effects and transitions have a `prefers-reduced-motion` fallback. Verdicts, hashes and measured values remain immediately available to assistive technology. Collapsed navigation keeps named links and browser-native title tooltips. Route focus and inactive-page behavior remain in `App.tsx`.

## Reproduce the build

From `frontend`:

```powershell
npm ci
npm test -- --run
npm run build
```

From the repository root, with the documented Python environment:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\build-windows.bat
```

For environments where pytest cannot access its default Windows temp directory, pass `--basetemp` pointing at a writable directory. For visual review, exercise each workflow in the packaged desktop app, toggle the sidebar, inspect charts with missing measurements, navigate with a keyboard and enable reduced motion.
