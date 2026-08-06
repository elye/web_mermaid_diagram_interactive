/**
 * Shared SVG inline-style helpers used by DiagramCanvas and related modules.
 */

/**
 * Given any CSS color string, return '#000000' or '#ffffff' — whichever
 * gives better contrast (WCAG relative luminance formula).
 *
 * Used to auto-derive a readable label color when the user sets a fill
 * override on a node or cluster.
 */
export function contrastColor(css: string): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '#000000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a < 10) return '#000000'; // transparent — default dark
    // sRGB linearisation then relative luminance (WCAG 2.1)
    const toLinear = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    return L > 0.179 ? '#000000' : '#ffffff';
  } catch {
    return '#000000';
  }
}

/**
 * Set (or clear, when `value` is `''`) an inline style property with
 * `!important` priority. Mermaid's `classDef`/`class` directive emits its
 * own `!important` CSS rules (e.g. `.src>* { fill: ...!important; }`), so a
 * plain (non-important) inline style would silently lose to it. Clearing
 * uses `removeProperty` so Mermaid's own styling wins back once the override
 * is removed.
 */
export function setImportantStyle(
  el: SVGElement | HTMLElement,
  prop: string,
  value: string,
): void {
  if (value) {
    el.style.setProperty(prop, value, 'important');
  } else {
    el.style.removeProperty(prop);
  }
}
