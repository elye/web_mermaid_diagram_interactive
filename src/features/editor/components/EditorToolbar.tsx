/**
 * Toolbar — top app bar. File actions, theme toggle, export.
 */
import { Button } from '@/shared/components/Button';
import { useUiStore, type Theme } from '@/stores/uiStore';
import { useHistoryStore } from '@/stores/historyStore';
import { serializeToFile } from '@/features/file-io/services/fileSerializer';
import { downloadBlob } from '@/features/file-io/services/download';
import { exportSvg } from '@/features/file-io/services/exportSvg';
import { exportPng } from '@/features/file-io/services/exportPng';
import { encodeToUrlHash } from '@/features/sharing/services/urlEncoder';
import { ToastContainer } from '@/shared/components/Toast';

export function Toolbar() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const pushToast = useUiStore((s) => s.pushToast);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const cycleTheme = () => {
    const order: Theme[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const save = () => {
    downloadBlob(serializeToFile(), 'diagram.mermaidflow');
    pushToast({ kind: 'success', message: 'Saved as .mermaidflow' });
  };

  const doExportSvg = async () => {
    const blob = await exportSvg();
    if (!blob) {
      pushToast({ kind: 'error', message: 'Nothing to export yet.' });
      return;
    }
    downloadBlob(blob, 'diagram.svg');
  };

  const doExportPng = async () => {
    try {
      const blob = await exportPng(2);
      if (!blob) throw new Error('empty');
      downloadBlob(blob, 'diagram.png');
    } catch {
      pushToast({ kind: 'error', message: 'PNG export failed.' });
    }
  };

  const share = async () => {
    const url = encodeToUrlHash();
    await navigator.clipboard.writeText(url);
    pushToast({ kind: 'success', message: 'Share URL copied to clipboard.' });
  };

  return (
    <header
      role="banner"
      className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-3"
    >
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold tracking-tight">
          <span aria-hidden>🧜‍♀️</span> MermaidFlow
        </h1>
      </div>
      <div className="flex items-center gap-1">
        <Button onClick={undo} title="Undo (⌘Z)">Undo</Button>
        <Button onClick={redo} title="Redo (⌘⇧Z)">Redo</Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button onClick={save} title="Save (⌘S)">Save</Button>
        <Button onClick={doExportSvg}>Export SVG</Button>
        <Button onClick={doExportPng}>Export PNG</Button>
        <Button onClick={share}>Share</Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button onClick={cycleTheme} title={`Theme: ${theme}`}>
          {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
        </Button>
      </div>
      <ToastContainer />
    </header>
  );
}
