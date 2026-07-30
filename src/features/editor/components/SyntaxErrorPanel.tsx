/**
 * SyntaxErrorPanel — sticky footer that shows the latest Mermaid parse error.
 */
import { useDiagramStore } from '@/stores/diagramStore';

export function SyntaxErrorPanel() {
  const err = useDiagramStore((s) => s.renderError);
  if (!err) return null;
  return (
    <div
      role="alert"
      className="max-h-32 shrink-0 overflow-auto border-t border-red-500/50 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-500"
    >
      {err}
    </div>
  );
}
