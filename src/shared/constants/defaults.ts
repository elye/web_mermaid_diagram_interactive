/**
 * Application-wide default values.
 */
export const DEFAULT_MERMAID_SOURCE = `flowchart TD
  A[Start] --> B{Is it working?}
  B -- Yes --> C[Ship it 🚀]
  B -- No --> D[Debug]
  D --> B
`;

export const RENDER_DEBOUNCE_MS = 300;
export const AUTOSAVE_DEBOUNCE_MS = 500;
export const HISTORY_LIMIT = 100;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;
