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
- **Per-node styling** — properties panel with fill / stroke / stroke width,
  plus one-click presets (Success / Warning / Error / Muted).
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

## 🧪 Testing

```bash
npm run test           # vitest
npm run test:coverage
npm run e2e            # playwright (empty by default)
```

## 📄 License

MIT
