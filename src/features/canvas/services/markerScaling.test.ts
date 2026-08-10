import { describe, it, expect, beforeEach } from 'vitest';
import { scaleMarker, applyMarkerScaling, applyMarkerStartScaling } from './markerScaling';

describe('markerScaling', () => {
  let svg: SVGSVGElement;
  let defs: SVGDefsElement;
  let originalMarker: SVGMarkerElement;
  let testPath: SVGPathElement;

  beforeEach(() => {
    // Create a minimal SVG DOM structure
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    
    // Create an original marker (Mermaid-style arrow)
    originalMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    originalMarker.id = 'test-arrow';
    originalMarker.setAttribute('markerWidth', '12');
    originalMarker.setAttribute('markerHeight', '12');
    originalMarker.setAttribute('refX', '6');
    originalMarker.setAttribute('refY', '5');
    originalMarker.setAttribute('viewBox', '0 0 10 10');
    originalMarker.setAttribute('markerUnits', 'userSpaceOnUse');
    
    // Create the arrow path (triangle)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    originalMarker.appendChild(path);
    
    defs.appendChild(originalMarker);
    svg.appendChild(defs);
    document.body.appendChild(svg);
    
    // Create a test edge path
    testPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    testPath.setAttribute('d', 'M 0 0 L 100 100');
    testPath.setAttribute('data-edge-id', 'test-edge');
    svg.appendChild(testPath);
  });

  afterEach(() => {
    document.body.removeChild(svg);
  });

  describe('scaleMarker', () => {
    it('should return original marker ID when scale factor is 1.0', () => {
      const result = scaleMarker(originalMarker, 1.0, svg);
      expect(result).toBe(originalMarker.id);
    });

    it('should fix original marker refX to 85% of tip when scale factor is 1.0', () => {
      scaleMarker(originalMarker, 1.0, svg);
      // Tip is at x=10, so refX should be 10 * 0.85 = 8.5
      expect(parseFloat(originalMarker.getAttribute('refX')!)).toBe(8.5);
    });

    it('should not fix original marker refX twice', () => {
      scaleMarker(originalMarker, 1.0, svg);
      const firstRefX = originalMarker.getAttribute('refX');
      
      // Call again
      scaleMarker(originalMarker, 1.0, svg);
      const secondRefX = originalMarker.getAttribute('refX');
      
      expect(firstRefX).toBe(secondRefX);
      expect(originalMarker.getAttribute('data-refx-fixed')).toBe('true');
    });

    it('should create a scaled marker clone for scale factor 1.5', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      
      expect(result).not.toBe(originalMarker.id);
      expect(result).toContain('__scaled-');
      expect(result).toContain('150');
      
      const scaledMarker = document.getElementById(result) as unknown as SVGMarkerElement;
      expect(scaledMarker).toBeDefined();
    });

    it('should scale marker dimensions correctly', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as unknown as SVGMarkerElement;
      
      // Original: 12x12, scaled to 1.5x: should be 18x18
      expect(parseFloat(scaledMarker.getAttribute('markerWidth')!)).toBe(18);
      expect(parseFloat(scaledMarker.getAttribute('markerHeight')!)).toBe(18);
    });

    it('should set refX to 85% of scaled tip position', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as unknown as SVGMarkerElement;
      
      // Scaled tip: 10 * 1.5 = 15, refX should be 15 * 0.85 = 12.75
      expect(parseFloat(scaledMarker.getAttribute('refX')!)).toBe(12.75);
    });

    it('should scale refY proportionally', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as unknown as SVGMarkerElement;
      
      // Original refY: 5, scaled to 1.5x: should be 7.5
      expect(parseFloat(scaledMarker.getAttribute('refY')!)).toBe(7.5);
    });

    it('should remove viewBox from scaled marker', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as unknown as SVGMarkerElement;
      
      expect(scaledMarker.getAttribute('viewBox')).toBeNull();
    });

    it('should scale path coordinates', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as unknown as SVGMarkerElement;
      const scaledPath = scaledMarker.querySelector('path[d]');
      
      // Original path: M 0 0 L 10 5 L 0 10 z
      // Scaled by 1.5: M 0 0 L 15 7.5 L 0 15 z
      expect(scaledPath?.getAttribute('d')).toBe('M 0 0 L 15 7.5 L 0 15 z');
    });

    it('should reuse existing scaled marker on subsequent calls', () => {
      const result1 = scaleMarker(originalMarker, 1.5, svg);
      const result2 = scaleMarker(originalMarker, 1.5, svg);
      
      expect(result1).toBe(result2);
    });

    it('should handle scale factor 0.5 correctly', () => {
      const result = scaleMarker(originalMarker, 0.5, svg);
      const scaledMarker = document.getElementById(result) as unknown as SVGMarkerElement;
      
      // Scaled to 0.5x: markerWidth should be 6, tip at 5, refX = 5 * 0.85 = 4.25
      expect(parseFloat(scaledMarker.getAttribute('markerWidth')!)).toBe(6);
      expect(parseFloat(scaledMarker.getAttribute('refX')!)).toBe(4.25);
    });

    it('should handle scale factor 2.5 correctly', () => {
      const result = scaleMarker(originalMarker, 2.5, svg);
      const scaledMarker = document.getElementById(result) as unknown as SVGMarkerElement;
      
      // Scaled to 2.5x: markerWidth should be 30, tip at 25, refX = 25 * 0.85 = 21.25
      expect(parseFloat(scaledMarker.getAttribute('markerWidth')!)).toBe(30);
      expect(parseFloat(scaledMarker.getAttribute('refX')!)).toBe(21.25);
    });
  });

  describe('applyMarkerScaling', () => {
    it('should apply marker scaling to edge path', () => {
      testPath.setAttribute('marker-end', `url(#${originalMarker.id})`);
      
      // 1.5px stroke / 2px base = 0.75 = 75% scale
      applyMarkerScaling(testPath, 1.5, svg);
      
      const markerEnd = testPath.getAttribute('marker-end');
      expect(markerEnd).toContain('__scaled-75');
    });

    it('should not change marker for base stroke width', () => {
      const originalMarkerId = originalMarker.id;
      testPath.setAttribute('marker-end', `url(#${originalMarkerId})`);
      
      applyMarkerScaling(testPath, 2, svg);
      
      // Should keep the same marker (original gets refX fixed)
      const markerEnd = testPath.getAttribute('marker-end');
      expect(markerEnd).toContain(originalMarkerId);
      // And original marker should have fixed refX
      expect(originalMarker.getAttribute('data-refx-fixed')).toBe('true');
    });

    it('should handle missing marker-end attribute', () => {
      // Should not throw
      expect(() => {
        applyMarkerScaling(testPath, 1.5, svg);
      }).not.toThrow();
    });
  });

  describe('applyMarkerStartScaling', () => {
    it('should apply marker scaling to marker-start attribute', () => {
      testPath.setAttribute('marker-start', `url(#${originalMarker.id})`);
      
      // 1.5px stroke / 2px base = 0.75 = 75% scale
      applyMarkerStartScaling(testPath, 1.5, svg);
      
      const markerStart = testPath.getAttribute('marker-start');
      expect(markerStart).toContain('__scaled-75');
    });

    it('should handle missing marker-start attribute', () => {
      // Should not throw
      expect(() => {
        applyMarkerStartScaling(testPath, 1.5, svg);
      }).not.toThrow();
    });
  });

  describe('circle markers (o--o)', () => {
    let circleEndMarker: SVGMarkerElement;
    let circleStartMarker: SVGMarkerElement;

    beforeEach(() => {
      // Mermaid flowchart-circleEnd: viewBox="0 0 10 10", cx=5, cy=5, r=5, refX=11, markerWidth=11
      circleEndMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      circleEndMarker.id = 'test-circleEnd';
      circleEndMarker.setAttribute('markerWidth', '11');
      circleEndMarker.setAttribute('markerHeight', '11');
      circleEndMarker.setAttribute('refX', '11');
      circleEndMarker.setAttribute('refY', '5');
      circleEndMarker.setAttribute('viewBox', '0 0 10 10');
      circleEndMarker.setAttribute('markerUnits', 'userSpaceOnUse');
      const circleEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circleEl.setAttribute('cx', '5');
      circleEl.setAttribute('cy', '5');
      circleEl.setAttribute('r', '5');
      circleEndMarker.appendChild(circleEl);
      defs.appendChild(circleEndMarker);

      // Mermaid flowchart-circleStart: refX=-1 (left edge)
      circleStartMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      circleStartMarker.id = 'test-circleStart';
      circleStartMarker.setAttribute('markerWidth', '11');
      circleStartMarker.setAttribute('markerHeight', '11');
      circleStartMarker.setAttribute('refX', '-1');
      circleStartMarker.setAttribute('refY', '5');
      circleStartMarker.setAttribute('viewBox', '0 0 10 10');
      circleStartMarker.setAttribute('markerUnits', 'userSpaceOnUse');
      const circleEl2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circleEl2.setAttribute('cx', '5');
      circleEl2.setAttribute('cy', '5');
      circleEl2.setAttribute('r', '5');
      circleStartMarker.appendChild(circleEl2);
      defs.appendChild(circleStartMarker);
    });

    it('should fix circleEnd refX to right edge (cx+r=10) at scale 1', () => {
      scaleMarker(circleEndMarker, 1.0, svg);
      // cx=5, r=5, right edge = 10
      expect(parseFloat(circleEndMarker.getAttribute('refX')!)).toBe(10);
    });

    it('should fix circleStart refX to left edge (cx-r=0) at scale 1', () => {
      scaleMarker(circleStartMarker, 1.0, svg);
      // cx=5, r=5, left edge = 0
      expect(parseFloat(circleStartMarker.getAttribute('refX')!)).toBe(0);
    });

    it('should scale circle cx, cy, r when creating a scaled clone', () => {
      const scaledId = scaleMarker(circleEndMarker, 2.0, svg);
      const scaledMarker = document.getElementById(scaledId)!;
      const circle = scaledMarker.querySelector('circle')!;
      // Original: cx=5, cy=5, r=5 → scaled 2x: cx=10, cy=10, r=10
      expect(parseFloat(circle.getAttribute('cx')!)).toBe(10);
      expect(parseFloat(circle.getAttribute('cy')!)).toBe(10);
      expect(parseFloat(circle.getAttribute('r')!)).toBe(10);
    });

    it('should set circleEnd refX to right edge scaled (cx+r)*scale = 20 at scale 2', () => {
      const scaledId = scaleMarker(circleEndMarker, 2.0, svg);
      const scaledMarker = document.getElementById(scaledId)!;
      // cx=5, r=5, right edge in original=10, scaled 2x = 20
      expect(parseFloat(scaledMarker.getAttribute('refX')!)).toBe(20);
    });

    it('should set circleStart refX to 0 at scale 2', () => {
      const scaledId = scaleMarker(circleStartMarker, 2.0, svg);
      const scaledMarker = document.getElementById(scaledId)!;
      // cx=5, r=5, left edge = 0, scaled 2x = 0
      expect(parseFloat(scaledMarker.getAttribute('refX')!)).toBe(0);
    });

    it('should scale markerWidth/Height proportionally', () => {
      const scaledId = scaleMarker(circleEndMarker, 1.5, svg);
      const scaledMarker = document.getElementById(scaledId)!;
      expect(parseFloat(scaledMarker.getAttribute('markerWidth')!)).toBe(16.5);
      expect(parseFloat(scaledMarker.getAttribute('markerHeight')!)).toBe(16.5);
    });
  });

  describe('cross markers (x--x)', () => {
    let crossEndMarker: SVGMarkerElement;
    let crossStartMarker: SVGMarkerElement;

    beforeEach(() => {
      // Mermaid flowchart-crossEnd: viewBox="0 0 11 11", refX=8.5, path "M 1,1 l 9,9 M 10,1 l -9,9"
      const makeCross = (id: string) => {
        const m = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        m.id = id;
        m.setAttribute('markerWidth', '11');
        m.setAttribute('markerHeight', '11');
        m.setAttribute('refX', '8.5');
        m.setAttribute('refY', '5.2');
        m.setAttribute('viewBox', '0 0 11 11');
        m.setAttribute('markerUnits', 'userSpaceOnUse');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M 1,1 l 9,9 M 10,1 l -9,9');
        m.appendChild(path);
        defs.appendChild(m);
        return m;
      };
      crossEndMarker   = makeCross('test-crossEnd');
      crossStartMarker = makeCross('test-crossStart');
    });

    it('should fix crossEnd refX by preserving original ratio (8.5/11 * 10 ≈ 7.727) at scale 1', () => {
      scaleMarker(crossEndMarker, 1.0, svg);
      // origRefX=8.5, markerWidth=11, path maxX=10 → ratio=8.5/11, refX=ratio*10 ≈ 7.727
      expect(parseFloat(crossEndMarker.getAttribute('refX')!)).toBeCloseTo(7.727, 2);
    });

    it('should fix crossStart refX by preserving original ratio (8.5/11 * 10 ≈ 7.727) at scale 1', () => {
      scaleMarker(crossStartMarker, 1.0, svg);
      expect(parseFloat(crossStartMarker.getAttribute('refX')!)).toBeCloseTo(7.727, 2);
    });

    it('should set cross refX to ratio-based value * scale at scale 2', () => {
      const scaledId = scaleMarker(crossEndMarker, 2.0, svg);
      const scaledMarker = document.getElementById(scaledId)!;
      // refX at scale 1 ≈ 7.727, scaled 2x ≈ 15.454
      expect(parseFloat(scaledMarker.getAttribute('refX')!)).toBeCloseTo(15.454, 2);
    });

    it('should scale cross path coordinates', () => {
      const scaledId = scaleMarker(crossEndMarker, 2.0, svg);
      const scaledMarker = document.getElementById(scaledId)!;
      const path = scaledMarker.querySelector('path[d]')!;
      // Original: M 1,1 l 9,9 M 10,1 l -9,9 → scaled 2x: M 2,2 l 18,18 M 20,2 l -18,18
      expect(path.getAttribute('d')).toBe('M 2,2 l 18,18 M 20,2 l -18,18');
    });

    it('should scale cross markerWidth/Height proportionally', () => {
      const scaledId = scaleMarker(crossEndMarker, 2.0, svg);
      const scaledMarker = document.getElementById(scaledId)!;
      expect(parseFloat(scaledMarker.getAttribute('markerWidth')!)).toBe(22);
      expect(parseFloat(scaledMarker.getAttribute('markerHeight')!)).toBe(22);
    });
  });

  describe('TIP_ATTACHMENT_RATIO consistency', () => {
    it('should use consistent 85% attachment ratio for all scales', () => {
      const scales = [0.5, 0.75, 1.0, 1.5, 2.0, 2.5];
      const attachmentRatios: number[] = [];
      
      // Clear any fixed markers to reset
      originalMarker.removeAttribute('data-refx-fixed');
      
      for (const scale of scales) {
        const markerId = scaleMarker(originalMarker, scale, svg);
        const marker = document.getElementById(markerId) as unknown as SVGMarkerElement;
        
        if (marker) {
          const refX = parseFloat(marker.getAttribute('refX')!);
          const pathD = marker.querySelector('path[d]')?.getAttribute('d') || '';
          
          // Extract tip x coordinate
          const matches = [...pathD.matchAll(/L\s+(\d+\.?\d*)/g)];
          if (matches.length > 0) {
            const tipX = parseFloat(matches[0][1]);
            const ratio = refX / tipX;
            attachmentRatios.push(ratio);
          }
        }
      }
      
      // All ratios should be approximately 0.85
      attachmentRatios.forEach(ratio => {
        expect(ratio).toBeCloseTo(0.85, 2);
      });
    });
  });
});
