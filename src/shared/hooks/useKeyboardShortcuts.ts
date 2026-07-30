/**
 * useKeyboardShortcuts / registerDefaultShortcuts
 * -----------------------------------------------
 * Simple global keyboard shortcut dispatcher. Skips events originating
 * in editable elements unless explicitly allowed.
 */
import { useHistoryStore } from '@/stores/historyStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useDiagramStore } from '@/stores/diagramStore';
import { serializeToFile } from '@/features/file-io/services/fileSerializer';
import { downloadBlob } from '@/features/file-io/services/download';

type Handler = (e: KeyboardEvent) => void;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (target.isContentEditable) return true;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // CodeMirror editors
  if (target.closest('.cm-editor')) return true;
  return false;
}

/**
 * Register default global shortcuts. Returns a cleanup fn.
 */
export function registerDefaultShortcuts(): () => void {
  const handler: Handler = (e) => {
    const mod = e.metaKey || e.ctrlKey;

    // Undo/redo — allowed globally (CodeMirror handles its own; we only fire
    // if the event target is NOT the editor, so canvas edits get undone).
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (!isTypingTarget(e.target)) {
        e.preventDefault();
        useHistoryStore.getState().undo();
      }
      return;
    }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      if (!isTypingTarget(e.target)) {
        e.preventDefault();
        useHistoryStore.getState().redo();
      }
      return;
    }

    // Save
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      const blob = serializeToFile();
      downloadBlob(blob, 'diagram.mermaidflow');
      return;
    }

    // Delete selected (canvas context only)
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isTypingTarget(e.target)) {
      const sel = useSelectionStore.getState();
      if (sel.selectedNodeIds.size > 0) {
        e.preventDefault();
        useDiagramStore.getState().deleteNodes(Array.from(sel.selectedNodeIds));
        sel.clear();
      }
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
