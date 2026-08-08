/**
 * CodeEditor — CodeMirror 6 wired to diagramStore.source.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { mermaidLanguage } from '../services/mermaidLanguage';
import { useDiagramStore } from '@/stores/diagramStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUiStore } from '@/stores/uiStore';
import { SyntaxErrorPanel } from './SyntaxErrorPanel';

export function CodeEditor() {
  const source = useDiagramStore((s) => s.source);
  const setSource = useDiagramStore((s) => s.setSource);
  const commit = useHistoryStore((s) => s.commit);
  const theme = useUiStore((s) => s.theme);
  const ref = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo(() => [mermaidLanguage(), EditorView.lineWrapping], []);

  const onChange = useCallback(
    (value: string) => {
      setSource(value);
    },
    [setSource],
  );

  // Commit history snapshot on blur (coarse-grained undo).
  const onBlur = useCallback(() => {
    commit();
  }, [commit]);

  // Reflect external programmatic source changes (file load, undo/redo)
  // into the editor if not already in sync.
  useEffect(() => {
    const view = ref.current?.view;
    if (view && view.state.doc.toString() !== source) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
      });
    }
  }, [source]);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <CodeMirror
        ref={ref}
        value={source}
        onChange={onChange}
        onBlur={onBlur}
        theme={isDark ? 'dark' : 'light'}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          bracketMatching: true,
          autocompletion: true,
          foldGutter: true,
        }}
        height="100%"
        className="min-h-0 flex-1 overflow-auto"
      />
      <SyntaxErrorPanel />
    </div>
  );
}
