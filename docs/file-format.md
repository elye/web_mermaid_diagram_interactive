# `.mermaidflow` file format

Current writer emits **v1.1**. The loader accepts both v1.0 and v1.1.

## Version history

| Version | Added |
| ------- | ----- |
| `1.0`   | Initial: `mermaidSource`, `positionOverrides`, `styleOverrides`, `annotations`, `theme`, `viewportState`, `metadata`. |
| `1.1`   | `edgeStyles`, `edgeWaypoints`, `edgeAnchorOverrides` — makes reshaped, re-anchored, and restyled edges survive save/reload. |

## Example (v1.1)

```jsonc
{
  "version": "1.1",
  "mermaidSource": "flowchart TD\n  A --> B",
  "positionOverrides": {
    "A": { "x": 120, "y": 40 },
    "B": { "x": 320, "y": 40 }
  },
  "styleOverrides": {
    "A": {
      "fill": "#dcfce7",
      "stroke": "#16a34a",
      "strokeWidth": 2,
      "fontColor": "#14532d"
    }
  },
  "edgeStyles": {
    "L-A-B-0": {
      "stroke": "#0ea5e9",
      "strokeWidth": 2,
      "lineStyle": "curve"
    }
  },
  "edgeWaypoints": {
    "L-A-B-0": [{ "x": 220, "y": 100 }]
  },
  "edgeAnchorOverrides": {
    "L-A-B-0": {
      "source": { "side": "right", "offset": 0.5 },
      "target": { "side": "left",  "offset": 0.5 }
    }
  },
  "annotations": [
    {
      "id": "note_1",
      "text": "Manual review required",
      "position": { "x": 200, "y": 80 },
      "style": { "fill": "#fef3c7" }
    }
  ],
  "theme": "system",
  "viewportState": { "zoom": 1.25, "panX": -40, "panY": 0 },
  "metadata": {
    "createdAt": "2026-01-01T12:00:00.000Z",
    "lastModified": "2026-01-01T12:00:00.000Z"
  }
}
```

## Fields

| Field                  | Version | Type                                                      | Description                                                                                              |
| ---------------------- | ------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `version`              | 1.0+    | `"1.0" \| "1.1"`                                          | Schema version. Files with unknown versions are rejected with a toast.                                   |
| `mermaidSource`        | 1.0+    | `string`                                                  | The user-authored Mermaid source. Always the authoritative structure.                                    |
| `positionOverrides`    | 1.0+    | `Record<nodeId, {x,y}>`                                   | Absolute translate values applied on top of Mermaid's auto layout. Keys match `data-node-id`.            |
| `styleOverrides`       | 1.0+    | `Record<nodeId, StyleOverride>`                           | Per-node style patches (`fill`, `stroke`, `strokeWidth`, `fontColor`, `fontSize`, `dashArray`).          |
| `edgeStyles`           | 1.1     | `Record<edgeId, StyleOverride>`                           | Per-edge style patches. Adds `lineStyle: 'curve' \| 'straight' \| 'orthogonal'` on top of `StyleOverride`. |
| `edgeWaypoints`        | 1.1     | `Record<edgeId, {x,y}[]>`                                 | Control points that reshape a curve-mode edge (or rotate a self-loop). Keys match `data-edge-id`.        |
| `edgeAnchorOverrides`  | 1.1     | `Record<edgeId, { source?, target? }>`                    | Pins an edge's `source` / `target` end to a specific `{side, offset}` on its node's perimeter.           |
| `annotations`          | 1.0+    | `Annotation[]`                                            | Free-floating text boxes not stored in Mermaid source.                                                   |
| `theme`                | 1.0+    | `"light" \| "dark" \| "system"`                           | Applied on load. Falls back to `system` if unknown.                                                      |
| `viewportState`        | 1.0+    | `{zoom, panX, panY}`                                      | Restores camera position on open.                                                                        |
| `metadata`             | 1.0+    | `{createdAt, lastModified}`                               | ISO timestamps.                                                                                          |

## Backward compatibility

Opening a **v1.0** file simply loads with the three v1.1-only fields
treated as empty maps — no data loss on the v1.0 side, no crash. Re-saving
that diagram from the current writer produces a v1.1 file.

## Round-trip guarantees

Opening a `.mermaidflow` file and then re-saving it (without any edits)
produces an object that is deep-equal to the original, modulo the
`lastModified` timestamp and (for v1.0 → v1.1 in-place upgrades) the newly
initialised empty edge-state maps.

## `.mmd` compatibility

Opening a plain `.mmd` file:

- populates `mermaidSource`,
- resets `positionOverrides`, `styleOverrides`, `edgeStyles`,
  `edgeWaypoints`, `edgeAnchorOverrides`, and `annotations` to empty,
- leaves `theme` / `viewportState` untouched.

Exporting a diagram opened from `.mmd` as `.mermaidflow` upgrades it in place.

## Autosave

The app also mirrors this schema (`v1.1`) into
`localStorage['mf.autosave.v1']` on a 500 ms debounce, and calls a
synchronous flush on `pagehide` / `beforeunload` so an edit made just
before refresh survives the reload.
