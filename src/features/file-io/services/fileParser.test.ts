import { describe, it, expect, beforeEach } from 'vitest';
import { loadFromText, hydrateFromFile } from './fileParser';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import type { MermaidFlowFileV1, MermaidFlowFileV1_1 } from '@/shared/types/file';

const baseMetadata = {
  createdAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-01T00:00:00.000Z',
};

const v1Sample: MermaidFlowFileV1 = {
  version: '1.0',
  mermaidSource: 'flowchart TD\n  A --> B',
  positionOverrides: { A: { x: 10, y: 20 } },
  styleOverrides: { A: { fill: '#123' } },
  annotations: [],
  theme: 'system',
  viewportState: { zoom: 1, panX: 0, panY: 0 },
  metadata: baseMetadata,
};

const v11Sample: MermaidFlowFileV1_1 = {
  version: '1.1',
  mermaidSource: 'flowchart TD\n  A --> B',
  positionOverrides: { A: { x: 10, y: 20 } },
  styleOverrides: { A: { fill: '#123' } },
  edgeStyles: { 'L-A-B-0': { stroke: '#456', lineStyle: 'straight' } },
  edgeWaypoints: { 'L-A-B-0': [{ x: 50, y: 50 }] },
  edgeAnchorOverrides: { 'L-A-B-0': { target: { side: 'left', offset: 0.4 } } },
  annotations: [],
  theme: 'system',
  viewportState: { zoom: 1, panX: 0, panY: 0 },
  metadata: baseMetadata,
};

describe('fileParser', () => {
  beforeEach(() => {
    useDiagramStore.setState({
      source: '',
      positionOverrides: {},
      edgeWaypoints: {},
      edgeAnchorOverrides: {},
    });
    useStyleStore.setState({ nodeStyles: {}, edgeStyles: {}, annotations: [] });
  });

  it('accepts v1.0 files and hydrates unknown v1.1 fields as empty', () => {
    hydrateFromFile(v1Sample);
    expect(useDiagramStore.getState().source).toContain('flowchart');
    expect(useDiagramStore.getState().positionOverrides.A).toEqual({ x: 10, y: 20 });
    // v1.0 → no edge data.
    expect(useDiagramStore.getState().edgeWaypoints).toEqual({});
    expect(useDiagramStore.getState().edgeAnchorOverrides).toEqual({});
    expect(useStyleStore.getState().edgeStyles).toEqual({});
  });

  it('accepts v1.1 files and hydrates edge waypoints / anchors / styles', () => {
    hydrateFromFile(v11Sample);
    expect(useDiagramStore.getState().edgeWaypoints['L-A-B-0']).toEqual([
      { x: 50, y: 50 },
    ]);
    expect(useDiagramStore.getState().edgeAnchorOverrides['L-A-B-0']).toEqual({
      target: { side: 'left', offset: 0.4 },
    });
    expect(useStyleStore.getState().edgeStyles['L-A-B-0'].stroke).toBe('#456');
    expect(useStyleStore.getState().edgeStyles['L-A-B-0'].lineStyle).toBe('straight');
  });

  it('loadFromText recognises a .mermaidflow JSON payload', () => {
    const result = loadFromText(JSON.stringify(v11Sample), 'x.mermaidflow');
    expect(result).toEqual({ kind: 'mermaidflow', ok: true });
    expect(useDiagramStore.getState().edgeWaypoints['L-A-B-0']).toBeDefined();
  });

  it('loadFromText treats non-JSON files as raw Mermaid source', () => {
    const result = loadFromText('flowchart TD\n  X --> Y', 'x.mmd');
    expect(result).toEqual({ kind: 'mermaid', ok: true });
    expect(useDiagramStore.getState().source).toContain('X --> Y');
  });

  it('loadFromText rejects unknown versions', () => {
    const bad = JSON.stringify({ ...v1Sample, version: '99.0' });
    const result = loadFromText(bad, 'x.mermaidflow');
    expect(result.ok).toBe(false);
  });

  it('loadFromText returns an error on invalid JSON', () => {
    const result = loadFromText('{not json', 'x.mermaidflow');
    expect(result.ok).toBe(false);
  });
});
