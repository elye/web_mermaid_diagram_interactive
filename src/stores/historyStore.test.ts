import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDiagramStore } from './diagramStore';
import { useStyleStore } from './styleStore';
import { useHistoryStore } from './historyStore';

describe('historyStore', () => {
  beforeEach(() => {
    useDiagramStore.setState({
      source: 'A',
      positionOverrides: {},
      edgeWaypoints: {},
      edgeAnchorOverrides: {},
    });
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

  it('undoes edge waypoint changes (regression: mid-dot must move on undo)', () => {
    useDiagramStore.setState({ edgeWaypoints: { e1: [{ x: 10, y: 10 }] } });
    useHistoryStore.getState().commit();
    useDiagramStore.setState({ edgeWaypoints: { e1: [{ x: 500, y: 500 }] } });

    useHistoryStore.getState().undo();
    expect(useDiagramStore.getState().edgeWaypoints.e1).toEqual([{ x: 10, y: 10 }]);
  });

  it('undoes edge anchor overrides', () => {
    useDiagramStore.setState({
      edgeAnchorOverrides: { e1: { target: { side: 'top', offset: 0.5 } } },
    });
    useHistoryStore.getState().commit();
    useDiagramStore.setState({
      edgeAnchorOverrides: { e1: { target: { side: 'bottom', offset: 0.2 } } },
    });

    useHistoryStore.getState().undo();
    expect(useDiagramStore.getState().edgeAnchorOverrides.e1).toEqual({
      target: { side: 'top', offset: 0.5 },
    });
  });

  it('undoes edge style + node style changes', () => {
    useStyleStore.setState({
      nodeStyles: { A: { fill: '#ff0000' } },
      edgeStyles: { e1: { lineStyle: 'straight' } },
      annotations: [],
    });
    useHistoryStore.getState().commit();
    useStyleStore.setState({
      nodeStyles: { A: { fill: '#00ff00' } },
      edgeStyles: { e1: { lineStyle: 'curve' } },
      annotations: [],
    });

    useHistoryStore.getState().undo();
    expect(useStyleStore.getState().nodeStyles.A.fill).toBe('#ff0000');
    expect(useStyleStore.getState().edgeStyles.e1.lineStyle).toBe('straight');
  });

  it('captures multiple facets in a single commit (waypoints + anchors + styles)', () => {
    useDiagramStore.setState({
      edgeWaypoints: { e1: [{ x: 1, y: 1 }] },
      edgeAnchorOverrides: { e1: { source: { side: 'left', offset: 0.5 } } },
    });
    useStyleStore.setState({
      nodeStyles: {},
      edgeStyles: { e1: { stroke: '#123' } },
      annotations: [],
    });

    useHistoryStore.getState().commit();
    // Mutate everything simultaneously.
    useDiagramStore.setState({
      edgeWaypoints: {},
      edgeAnchorOverrides: {},
    });
    useStyleStore.setState({
      nodeStyles: {},
      edgeStyles: {},
      annotations: [],
    });

    useHistoryStore.getState().undo();
    expect(useDiagramStore.getState().edgeWaypoints.e1).toEqual([{ x: 1, y: 1 }]);
    expect(useDiagramStore.getState().edgeAnchorOverrides.e1).toEqual({
      source: { side: 'left', offset: 0.5 },
    });
    expect(useStyleStore.getState().edgeStyles.e1.stroke).toBe('#123');
  });
});

describe('historyStore — commitCoalesced', () => {
  beforeEach(() => {
    useDiagramStore.setState({
      source: 'A',
      positionOverrides: {},
      edgeWaypoints: {},
      edgeAnchorOverrides: {},
    });
    useStyleStore.setState({ nodeStyles: {}, edgeStyles: {}, annotations: [] });
    useHistoryStore.setState({ past: [], future: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    useHistoryStore.getState().endCoalesce();
    vi.useRealTimers();
  });

  it('collapses a rapid burst of same-key edits into a single undo step', () => {
    // Simulates dragging a stroke-width slider: many calls, same node,
    // each mutating the value further.
    useHistoryStore.getState().commitCoalesced('node:A');
    useStyleStore.setState({ nodeStyles: { A: { strokeWidth: 1 } }, edgeStyles: {}, annotations: [] });
    useHistoryStore.getState().commitCoalesced('node:A');
    useStyleStore.setState({ nodeStyles: { A: { strokeWidth: 2 } }, edgeStyles: {}, annotations: [] });
    useHistoryStore.getState().commitCoalesced('node:A');
    useStyleStore.setState({ nodeStyles: { A: { strokeWidth: 3 } }, edgeStyles: {}, annotations: [] });

    expect(useHistoryStore.getState().past).toHaveLength(1);

    useHistoryStore.getState().undo();
    // Undo restores the state from BEFORE the whole burst, not an
    // intermediate value.
    expect(useStyleStore.getState().nodeStyles.A).toBeUndefined();
  });

  it('switching the key (e.g. selecting a different node) starts a new step immediately', () => {
    useHistoryStore.getState().commitCoalesced('node:A');
    useStyleStore.setState({ nodeStyles: { A: { fill: '#111' } }, edgeStyles: {}, annotations: [] });
    useHistoryStore.getState().commitCoalesced('node:B');
    useStyleStore.setState({ nodeStyles: { A: { fill: '#111' }, B: { fill: '#222' } }, edgeStyles: {}, annotations: [] });

    expect(useHistoryStore.getState().past).toHaveLength(2);
  });

  it('starts a fresh step after the coalesce window elapses, even with the same key', () => {
    useHistoryStore.getState().commitCoalesced('node:A');
    useStyleStore.setState({ nodeStyles: { A: { fill: '#111' } }, edgeStyles: {}, annotations: [] });

    vi.advanceTimersByTime(1000); // past the 800ms idle window

    useHistoryStore.getState().commitCoalesced('node:A');
    useStyleStore.setState({ nodeStyles: { A: { fill: '#222' } }, edgeStyles: {}, annotations: [] });

    expect(useHistoryStore.getState().past).toHaveLength(2);
  });

  it('a plain commit() closes any pending coalesce session', () => {
    useHistoryStore.getState().commitCoalesced('node:A');
    useStyleStore.setState({ nodeStyles: { A: { fill: '#111' } }, edgeStyles: {}, annotations: [] });

    useHistoryStore.getState().commit(); // e.g. a node drag commit
    useHistoryStore.getState().commitCoalesced('node:A'); // same key, but session was closed

    expect(useHistoryStore.getState().past).toHaveLength(3);
  });
});
