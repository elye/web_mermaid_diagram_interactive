/**
 * Grow the SVG's `viewBox` (and inline `width`/`height`) so every node —
 * including those the user has dragged outside the original layout —
 * remains visible.
 *
 * Called after every drag frame and after every render, alongside the
 * edge router. Kept in its own tiny module because it's the ONLY code
 * that touches the SVG root's sizing attributes.
 */
import { groupBBox } from './svg';

/**
 * Fit the SVG's viewBox to the union of all annotated nodes, padded on
 * each side. No-op if the SVG has no annotated nodes yet.
 */
export function expandViewBoxToFit(svg: SVGSVGElement, padding = 40): void {
  const nodes = svg.querySelectorAll<SVGGElement>('g[data-node-id]');
  if (nodes.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((g) => {
    const r = groupBBox(g);
    if (!r) return;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  });

  if (!Number.isFinite(minX)) return;

  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  // Clear any max-width mermaid may have set inline so the SVG can grow.
  (svg as unknown as HTMLElement).style.maxWidth = 'none';
}
