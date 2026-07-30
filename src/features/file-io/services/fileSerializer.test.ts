import { describe, it, expect, beforeEach } from 'vitest';
import { buildFileObject } from './fileSerializer';
import { loadFromText } from './fileParser';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';

describe('.mermaidflow round-trip', () => {
  beforeEach(() => {
    useDiagramStore.setState({
      source: 'flowchart TD\n  A --> B',
      positionOverrides: { A: { x: 10, y: 20 } },
    });
    useStyleStore.setState({
      nodeStyles: { A: { fill: '#ff0000' } },
      edgeStyles: {},
      annotations: [],
    });
  });

  it('serialises to a valid JSON object and restores identical state', () => {
    const file = buildFileObject();
    expect(file.version).toBe('1.0');
    expect(file.mermaidSource).toContain('flowchart');

    // Clobber state, then restore.
    useDiagramStore.setState({ source: '', positionOverrides: {} });
    useStyleStore.setState({ nodeStyles: {}, edgeStyles: {}, annotations: [] });

    const result = loadFromText(JSON.stringify(file), 'x.mermaidflow');
    expect(result.ok).toBe(true);

    expect(useDiagramStore.getState().source).toContain('flowchart');
    expect(useDiagramStore.getState().positionOverrides.A).toEqual({ x: 10, y: 20 });
    expect(useStyleStore.getState().nodeStyles.A).toEqual({ fill: '#ff0000' });
  });

  it('treats plain text without JSON as raw Mermaid source', () => {
    const result = loadFromText('flowchart TD\n  X --> Y', 'x.mmd');
    expect(result.ok).toBe(true);
    expect(useDiagramStore.getState().source).toContain('X --> Y');
  });
});
