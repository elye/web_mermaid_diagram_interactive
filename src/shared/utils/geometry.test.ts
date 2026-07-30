import { describe, it, expect } from 'vitest';
import { anchorTowards, centerOf, cubicPath, translateBBox } from './geometry';

describe('geometry', () => {
  it('centerOf returns bbox center', () => {
    expect(centerOf({ x: 0, y: 0, width: 10, height: 20 })).toEqual({ x: 5, y: 10 });
  });

  it('translateBBox shifts by dx/dy', () => {
    expect(translateBBox({ x: 1, y: 2, width: 3, height: 4 }, 5, 6)).toEqual({
      x: 6,
      y: 8,
      width: 3,
      height: 4,
    });
  });

  it('anchorTowards picks the correct side', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const bRight = { x: 50, y: 0, width: 10, height: 10 };
    const anchor = anchorTowards(a, bRight);
    expect(anchor.x).toBe(10); // right edge
  });

  it('cubicPath produces well-formed SVG path', () => {
    const p = cubicPath({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(p).toMatch(/^M 0 0 C /);
    expect(p).toMatch(/, 100 50$/);
  });
});
