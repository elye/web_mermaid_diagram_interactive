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

  // Apply per-node position overrides after each render.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    Object.entries(positionOverrides).forEach(([id, pos]) => {
      const g = host.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(id)}"]`);
      if (g) g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    });
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
      <div
        ref={svgHostRef}
        className="absolute inset-0 flex origin-center items-center justify-center"
        style={{
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
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
