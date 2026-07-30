/**
 * exportPng — rasterise the current SVG into a PNG at the given scale.
 */
import { exportSvg } from './exportSvg';

export async function exportPng(scale = 2): Promise<Blob | null> {
  const svgBlob = await exportSvg();
  if (!svgBlob) return null;
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(svgUrl);
    const width = (img.naturalWidth || img.width || 800) * scale;
    const height = (img.naturalHeight || img.height || 600) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mf-surface') || '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
