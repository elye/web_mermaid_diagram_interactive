import { describe, it, expect } from 'vitest';
import { bezierPath, straightPath, orthogonalPath } from './paths';
import { waypointBezierPath } from './bezierChain';
import { selfLoopPath } from './selfLoop';

describe('paths — base emitters', () => {
  it('bezierPath produces a well-formed cubic starting/ending at the given points', () => {
    const d = bezierPath({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(d).toMatch(/^M 0 0 C /);
    expect(d).toContain(' 100 50');
  });

  it('bezierPath axis heuristic exits horizontally for a wide edge', () => {
    // dx dominates → src control point should be offset in +x.
    const d = bezierPath({ x: 0, y: 0 }, { x: 200, y: 10 });
    const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    // nums = [ax,ay, c1x,c1y, c2x,c2y, bx,by]
    expect(nums[2]).toBeGreaterThan(0); // c1x > ax
    expect(Math.abs(nums[3])).toBeLessThan(1); // c1y ~ ay (0)
  });

  it('bezierPath honours srcTangent / tgtTangent overrides', () => {
    // Wide edge but force vertical exit at src — c1 should move in +y, not +x.
    const d = bezierPath(
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 1 }, // src goes down
      { x: 0, y: -1 }, // tgt receives from below
    );
    const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(nums[2]).toBe(0); // c1x sits on src.x
    expect(nums[3]).toBeGreaterThan(0); // c1y offset downwards
  });

  it('straightPath is M…L…', () => {
    expect(straightPath({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe('M 1 2 L 3 4');
  });

  it('orthogonalPath picks horizontal-first for wide edges', () => {
    // Wide: expect two elbows at midX.
    const d = orthogonalPath({ x: 0, y: 0 }, { x: 100, y: 20 });
    expect(d).toBe('M 0 0 L 50 0 L 50 20 L 100 20');
  });

  it('orthogonalPath picks vertical-first for tall edges', () => {
    const d = orthogonalPath({ x: 0, y: 0 }, { x: 10, y: 100 });
    expect(d).toBe('M 0 0 L 0 50 L 10 50 L 10 100');
  });
});

describe('waypointBezierPath', () => {
  const rect = { x: 0, y: 0, width: 100, height: 50 };

  it('with no waypoints, matches bezierPath exactly', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 50 };
    expect(waypointBezierPath(a, [], b, rect, rect)).toBe(bezierPath(a, b));
  });

  it('with one waypoint, emits two chained cubic Béziers through the waypoint', () => {
    const a = { x: 0, y: 0 };
    const w = { x: 50, y: 100 };
    const b = { x: 100, y: 0 };
    const d = waypointBezierPath(a, [w], b, rect, rect);
    // M src, then two C … pairs.
    expect(d).toMatch(/^M 0 0 /);
    const cSegments = d.match(/ C /g) ?? [];
    expect(cSegments.length).toBe(2);
    // Waypoint (50, 100) must appear as the intermediate knot.
    expect(d).toContain('50 100');
    // Target must be the final knot.
    expect(d.endsWith('100 0')).toBe(true);
  });

  it('with two waypoints, emits three chained cubic Béziers', () => {
    const d = waypointBezierPath(
      { x: 0, y: 0 },
      [
        { x: 30, y: 50 },
        { x: 70, y: 50 },
      ],
      { x: 100, y: 0 },
      rect,
      rect,
    );
    const cSegments = d.match(/ C /g) ?? [];
    expect(cSegments.length).toBe(3);
    expect(d).toContain('30 50');
    expect(d).toContain('70 50');
  });
});

describe('selfLoopPath', () => {
  const nodeRect = { x: 100, y: 100, width: 60, height: 30 };

  it('default kidney sits on the right side of the node', () => {
    const d = selfLoopPath(nodeRect);
    // Starts at rightX = 160.
    expect(d).toMatch(/^M 160 /);
    // Loop must curve outside the rect (control x > right side).
    const xs = extractNumbers(d).filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeGreaterThan(160);
  });

  it('grows to clear a wide label', () => {
    const narrow = selfLoopPath(nodeRect, undefined, 20);
    const wide = selfLoopPath(nodeRect, undefined, 200);
    const narrowMaxX = Math.max(...extractNumbers(narrow).filter((_, i) => i % 2 === 0));
    const wideMaxX = Math.max(...extractNumbers(wide).filter((_, i) => i % 2 === 0));
    // Wide-label loop must extend further to the right.
    expect(wideMaxX).toBeGreaterThan(narrowMaxX);
    // And by roughly (labelWidth / 2) more.
    expect(wideMaxX - narrowMaxX).toBeGreaterThan(50);
  });

  it('with waypoint above, the loop opens on the TOP side and passes through the waypoint', () => {
    const waypoint = { x: 130, y: 40 };
    const d = selfLoopPath(nodeRect, waypoint);
    // Quadratic-through-point emits an M/Q pair.
    expect(d).toMatch(/^M .+ Q .+/);
    // Endpoints must sit on the top edge (y = 100).
    const nums = extractNumbers(d);
    const startY = nums[1];
    const endY = nums[nums.length - 1];
    expect(startY).toBe(100);
    expect(endY).toBe(100);
  });

  it('with waypoint to the right (cardinal), the two endpoints straddle the right side', () => {
    const waypoint = { x: 240, y: 115 };
    const d = selfLoopPath(nodeRect, waypoint);
    const nums = extractNumbers(d);
    const startX = nums[0];
    const endX = nums[nums.length - 2];
    // Both endpoints sit on the right side of the rect (x = 160).
    expect(startX).toBe(160);
    expect(endX).toBe(160);
  });
});

function extractNumbers(d: string): number[] {
  return d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
}
