/**
 * DiagramCanvas — mounts the rendered SVG, applies viewport transform,
 * wires pan/zoom and node-drag interactions, and applies style overrides
 * & position overrides on each render.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useUiStore } from '@/stores/uiStore';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import { useNodeDrag } from '../hooks/useNodeDrag';
import { routeAllEdges, expandViewBoxToFit } from '../services/edgeRouter';

export function DiagramCanvas() {
  useMermaidRender();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);

  const svg = useDiagramStore((s) => s.svg);
  const positionOverrides = useDiagramStore((s) => s.positionOverrides);
  const nodeStyles = useStyleStore((s) => s.nodeStyles);
  const edgeStyles = useStyleStore((s) => s.edgeStyles);
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const viewport = useUiStore((s) => s.viewport);

  const { onPointerDown } = useCanvasInteraction(containerRef);
  useNodeDrag(svgHostRef);

  // Inject SVG into DOM.
  useLayoutEffect(() => {
    if (svgHostRef.current) {
      svgHostRef.current.innerHTML = svg;
    }
  }, [svg]);

  // Apply per-node position overrides after each render, then re-run the
  // edge router so lines follow the overridden positions, then expand the
  // viewBox to fit. This is what makes moved nodes survive Mermaid re-renders
  // (which happen whenever the user types new source).
  useLayoutEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const svgEl = host.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;

    // Never clip a moved node.
    svgEl.style.overflow = 'visible';
    (svgEl.style as CSSStyleDeclaration).maxWidth = 'none';

    // Only apply overrides for node IDs that still exist in the freshly
    // rendered SVG. Stale IDs from a previous source revision are ignored,
    // but kept in the store so undo can restore them.
    Object.entries(positionOverrides).forEach(([id, pos]) => {
      const g = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(id)}"]`);
      if (g) g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    });

    routeAllEdges(svgEl);
    expandViewBoxToFit(svgEl);
  }, [positionOverrides, svg]);

  // Apply per-node/edge style overrides.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    Object.entries(nodeStyles).forEach(([id, style]) => {
      const g = host.querySelector(`g[data-node-id="${cssEscape(id)}"]`);
      if (!g) return;
      const shape = g.querySelector('rect, polygon, circle, ellipse, path') as SVGElement | null;
      if (shape) {
        if (style.fill) shape.style.fill = style.fill;
        if (style.stroke) shape.style.stroke = style.stroke;
        if (style.strokeWidth) shape.style.strokeWidth = String(style.strokeWidth);
      }
      const text = g.querySelector('text, .nodeLabel') as SVGElement | HTMLElement | null;
      if (text) {
        if (style.fontColor) (text as HTMLElement).style.color = style.fontColor;
        if (style.fontSize) (text as HTMLElement).style.fontSize = `${style.fontSize}px`;
      }
    });
    Object.entries(edgeStyles).forEach(([id, style]) => {
      const p = host.querySelector(`path[data-edge-id="${cssEscape(id)}"]`) as SVGElement | null;
      if (!p) return;
      if (style.stroke) p.style.stroke = style.stroke;
      if (style.strokeWidth) p.style.strokeWidth = String(style.strokeWidth);
      if (style.dashArray) p.style.strokeDasharray = style.dashArray;
    });
  }, [nodeStyles, edgeStyles, svg]);

  // Reflect selection in DOM.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    host.querySelectorAll('.mf-node--selected').forEach((el) => el.classList.remove('mf-node--selected'));
    selectedNodeIds.forEach((id) => {
      const g = host.querySelector(`g[data-node-id="${cssEscape(id)}"]`);
      g?.classList.add('mf-node--selected');
    });
  }, [selectedNodeIds, svg]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Diagram canvas"
      onPointerDown={onPointerDown}
      className="mf-canvas relative h-full w-full overflow-hidden bg-surface"
      style={{ touchAction: 'none' }}
    >
      {/*
        The transform host is centered inside the viewport but must NOT clip
        its child — we intentionally omit overflow-hidden here so nodes that
        the user drags off the initial layout remain visible.
       */}
      <div
        ref={svgHostRef}
        className="absolute left-1/2 top-1/2 flex items-center justify-center"
        style={{
          transform: `translate(-50%, -50%) translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          transformOrigin: 'center center',
          transition: 'transform 60ms linear',
        }}
      />
    </div>
  );
}

function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
