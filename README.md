# MermaidFlow 🧜‍♀️

> Interactive Mermaid diagram editor with drag-and-drop layout, styling, and export.

MermaidFlow is a browser-based diagramming IDE that combines the readability of
[Mermaid](https://mermaid.js.org/) with the interactivity of tools like draw.io.
Write Mermaid on the left, see a live rendered diagram on the right, drag nodes
into place, style them, and export.

## ✨ Features

- **Split-pane editor** — CodeMirror 6 with a lightweight Mermaid mode on the
  left; live-rendered diagram on the right (debounced ~300ms).
- **Interactive canvas** — pan (drag background), zoom (mouse wheel / ⌘+wheel),
  drag any node, edges re-route on the fly.
- **Multi-select & delete** — Shift-click to add to selection, Delete removes.
- **Per-node and per-edge styling** — properties panel with fill / stroke / 
  stroke width, plus one-click presets (Success / Warning / Error / Muted).
  Arrow markers scale proportionally with edge stroke width (1.0–5.0px+).
- **Subgraph collapse/expand** — collapse individual subgraphs to compact
  120×40 boxes, or use **Collapse All / Expand All** buttons to toggle every
  subgraph at once.
- **Re-route (compact layout)** — after collapsing subgraphs, click ⟲ Route
  to re-arrange visible elements into a compact grid that fits the viewport's
  aspect ratio. Preserves reading order and re-routes all edges.
- **Zoom to fit** — click ⊞ Fit to auto-zoom and center only the visible
  content in the viewport (ignores hidden nodes inside collapsed clusters).
- **Proprietary `.mermaidflow` format** — round-trip everything: source, node
  position overrides, style overrides, annotations, viewport, theme.
- **Import / export** — drag-and-drop `.mmd` or `.mermaidflow`; export as SVG
  or high-DPI PNG.
- **Shareable URLs** — deflate + base64url encoded Mermaid source in the URL
  hash (compatible in spirit with mermaid.live).
- **Undo / redo** — coarse-grained snapshots across code, positions, styles.
- **Autosave** — localStorage every ~10s; restored on next visit.
- **Dark mode** — system-preference aware, with manual toggle.
- **Keyboard shortcuts** — ⌘S save, ⌘Z / ⌘⇧Z undo/redo, Delete, and more.

## 🚀 Quick start

```bash
npm install
npm run dev          # start dev server (Vite) on http://localhost:5173
npm run test         # run vitest unit + integration suite
npm run build        # produce production bundle
```

## 🛠️ Tech stack

| Layer     | Choice                                       |
| --------- | -------------------------------------------- |
| Framework | React 18 (function components + hooks)       |
| Language  | TypeScript, `strict: true`                   |
| State     | Zustand — one store per concern              |
| Editor    | CodeMirror 6 (`@uiw/react-codemirror`)       |
| Rendering | `mermaid` + custom SVG post-processing layer |
| Styling   | Tailwind CSS + CSS variables for theming     |
| Bundler   | Vite                                         |
| Testing   | Vitest + Testing Library (+ Playwright ready)|

## 🏗️ Architecture

See [`docs/architecture.md`](docs/architecture.md) for the module overview and
data-flow diagram. The rules in short:

- Features live under `src/features/*` and expose their public API via
  `index.ts` — nothing crosses feature boundaries otherwise.
- All business logic lives in `services/` modules that are pure and testable
  without a DOM (where feasible).
- All cross-module communication happens through the Zustand stores in
  `src/stores/`.

The canvas service layer — Mermaid post-processing, edge routing, viewBox
fitting — is broken into small, single-purpose modules under
`src/features/canvas/services/` (`svg/` primitives, `routing/` pipeline,
`edgeIds`, `viewbox`, and thin orchestrators). Every module is under ~160
lines and covered by a focused `vitest` suite.

## 📁 File format

See [`docs/file-format.md`](docs/file-format.md).

## ⌨️ Keyboard shortcuts

| Combo             | Action              |
| ----------------- | ------------------- |
| ⌘/Ctrl + S        | Save `.mermaidflow` |
| ⌘/Ctrl + Z        | Undo                |
| ⌘/Ctrl + ⇧ + Z    | Redo                |
| Delete / Backspace| Remove selection    |
| Mouse wheel       | Zoom (with ⌘ ideal) |
| Drag background   | Pan                 |
| Drag node         | Reposition node     |

## 🖱️ Canvas controls

The bottom-right corner of the canvas contains the control panel:

| Group      | Button   | Action                                                                 |
| ---------- | -------- | ---------------------------------------------------------------------- |
| Subgraphs  | ▶ All    | Collapse all subgraphs into 120×40 summary boxes                       |
| Subgraphs  | ▼ All    | Expand all subgraphs back to full detail                               |
| View       | ⟲ Route  | Re-layout visible elements into a viewport-fitting grid, re-route edges |
| View       | ⊞ Fit    | Zoom + pan to fit visible content tightly in the viewport              |
| Focus      | ⇄ ← → ↔ ○ | Connectivity highlight mode (sources, sinks, both, bidir, none)     |
| —          | 💬       | Toggle hover tooltips on/off                                           |
| Zoom       | ＋ － ⟳  | Zoom in / out / reset (100%)                                          |

## 🧪 Testing

```bash
npm run test           # vitest
npm run test:coverage
npm run e2e            # playwright (empty by default)
```

## 📄 License

MIT
