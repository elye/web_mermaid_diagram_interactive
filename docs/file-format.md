# `.mermaidflow` file format (v1.0)

A `.mermaidflow` file is a single JSON document with the following shape:

```jsonc
{
  "version": "1.0",
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

| Field             | Type                            | Description                                                                                     |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `version`         | `"1.0"`                         | Schema version. Files with unknown versions are rejected with a toast.                          |
| `mermaidSource`   | `string`                        | The user-authored Mermaid source. Always the authoritative structure.                           |
| `positionOverrides` | `Record<nodeId, {x,y}>`       | Absolute translate values applied on top of Mermaid's auto layout. Keys match `data-node-id`.   |
| `styleOverrides`  | `Record<nodeId, StyleOverride>` | Per-node style patches (`fill`, `stroke`, `strokeWidth`, `fontColor`, `fontSize`, `dashArray`). |
| `annotations`     | `Annotation[]`                  | Free-floating text boxes not stored in Mermaid source.                                          |
| `theme`           | `"light" | "dark" | "system"`   | Applied on load. Falls back to `system` if unknown.                                             |
| `viewportState`   | `{zoom, panX, panY}`            | Restores camera position on open.                                                               |
| `metadata`        | `{createdAt, lastModified}`     | ISO timestamps.                                                                                 |

## Round-trip guarantees

Opening a `.mermaidflow` file and then re-saving it (without any edits)
produces an object that is deep-equal to the original, modulo the
`lastModified` timestamp.

## `.mmd` compatibility

Opening a plain `.mmd` file:

- populates `mermaidSource`,
- resets `positionOverrides`, `styleOverrides`, and `annotations` to empty,
- leaves `theme` / `viewportState` untouched.

Exporting a diagram opened from `.mmd` as `.mermaidflow` upgrades it in place.
