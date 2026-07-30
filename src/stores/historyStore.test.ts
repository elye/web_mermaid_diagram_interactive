import { describe, it, expect, beforeEach } from 'vitest';
import { useDiagramStore } from './diagramStore';
import { useStyleStore } from './styleStore';
import { useHistoryStore } from './historyStore';

describe('historyStore', () => {
  beforeEach(() => {
    useDiagramStore.setState({ source: 'A', positionOverrides: {} });
    useStyleStore.setState({ nodeStyles: {}, edgeStyles: {}, annotations: [] });
    useHistoryStore.setState({ past: [], future: [] });
  });

  it('undoes source changes', () => {
    useHistoryStore.getState().commit();
    useDiagramStore.setState({ source: 'B' });
    useHistoryStore.getState().commit();
    useDiagramStore.setState({ source: 'C' });

    useHistoryStore.getState().undo();
    expect(useDiagramStore.getState().source).toBe('B');
    useHistoryStore.getState().undo();
    expect(useDiagramStore.getState().source).toBe('A');
  });

  it('redoes after undo', () => {
    useHistoryStore.getState().commit();
    useDiagramStore.setState({ source: 'B' });
    useHistoryStore.getState().commit();
    useDiagramStore.setState({ source: 'C' });

    useHistoryStore.getState().undo();
    useHistoryStore.getState().redo();
    expect(useDiagramStore.getState().source).toBe('C');
  });

  it('is a no-op when history is empty', () => {
    expect(() => useHistoryStore.getState().undo()).not.toThrow();
    expect(() => useHistoryStore.getState().redo()).not.toThrow();
  });
});
