import { describe, it, expect, beforeEach } from 'vitest';
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
    expect(useDiagramStore.getState().edgeWaypoints).toEqual({ e1: [{ x: 1, y: 1 }] });
    expect(useDiagramStore.getState().edgeAnchorOverrides.e1).toEqual({
      source: { side: 'left', offset: 0.5 },
    });
    expect(useStyleStore.getState().edgeStyles.e1.stroke).toBe('#123');
  });
});
