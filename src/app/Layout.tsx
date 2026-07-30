/**
 * Layout
 * ------
 * Top-level chrome: header toolbar + resizable split pane
 * (editor left / canvas right).
 */
import { SplitPane } from '@/shared/components/SplitPane';
import { CodeEditor } from '@/features/editor/components/CodeEditor';
import { DiagramCanvas } from '@/features/canvas/components/DiagramCanvas';
import { Toolbar } from '@/features/editor/components/EditorToolbar';
import { CanvasControls } from '@/features/canvas/components/CanvasControls';
import { FileDropZone } from '@/features/file-io/components/FileDropZone';
import { PropertiesPanel } from '@/features/styling/components/PropertiesPanel';

export function Layout() {
  return (
    <div className="flex h-full w-full flex-col bg-surface text-ink">
      <Toolbar />
      <FileDropZone>
        <SplitPane
          left={
            <div className="h-full w-full bg-surface-alt">
              <CodeEditor />
            </div>
          }
          right={
            <div className="relative h-full w-full">
              <DiagramCanvas />
              <CanvasControls />
              <PropertiesPanel />
            </div>
          }
        />
      </FileDropZone>
    </div>
  );
}
