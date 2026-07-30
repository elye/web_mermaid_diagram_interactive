/**
 * exportSvg — return the current diagram SVG as a downloadable Blob.
 * Styles/positions/overrides applied by the DOM are captured live.
 */
export async function exportSvg(): Promise<Blob | null> {
  const host = document.querySelector('.mf-canvas');
  if (!host) return null;
  const svg = host.querySelector('svg');
  if (!svg) return null;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const text = new XMLSerializer().serializeToString(clone);
  return new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
}
