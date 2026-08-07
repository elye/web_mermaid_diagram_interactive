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
      
      const scaledMarker = document.getElementById(result) as SVGMarkerElement;
      expect(scaledMarker).toBeDefined();
    });

    it('should scale marker dimensions correctly', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as SVGMarkerElement;
      
      // Original: 12x12, scaled to 1.5x: should be 18x18
      expect(parseFloat(scaledMarker.getAttribute('markerWidth')!)).toBe(18);
      expect(parseFloat(scaledMarker.getAttribute('markerHeight')!)).toBe(18);
    });

    it('should set refX to 85% of scaled tip position', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as SVGMarkerElement;
      
      // Scaled tip: 10 * 1.5 = 15, refX should be 15 * 0.85 = 12.75
      expect(parseFloat(scaledMarker.getAttribute('refX')!)).toBe(12.75);
    });

    it('should scale refY proportionally', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as SVGMarkerElement;
      
      // Original refY: 5, scaled to 1.5x: should be 7.5
      expect(parseFloat(scaledMarker.getAttribute('refY')!)).toBe(7.5);
    });

    it('should remove viewBox from scaled marker', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as SVGMarkerElement;
      
      expect(scaledMarker.getAttribute('viewBox')).toBeNull();
    });

    it('should scale path coordinates', () => {
      const result = scaleMarker(originalMarker, 1.5, svg);
      const scaledMarker = document.getElementById(result) as SVGMarkerElement;
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
      const scaledMarker = document.getElementById(result) as SVGMarkerElement;
      
      // Scaled to 0.5x: markerWidth should be 6, tip at 5, refX = 5 * 0.85 = 4.25
      expect(parseFloat(scaledMarker.getAttribute('markerWidth')!)).toBe(6);
      expect(parseFloat(scaledMarker.getAttribute('refX')!)).toBe(4.25);
    });

    it('should handle scale factor 2.5 correctly', () => {
      const result = scaleMarker(originalMarker, 2.5, svg);
      const scaledMarker = document.getElementById(result) as SVGMarkerElement;
      
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

  describe('TIP_ATTACHMENT_RATIO consistency', () => {
    it('should use consistent 85% attachment ratio for all scales', () => {
      const scales = [0.5, 0.75, 1.0, 1.5, 2.0, 2.5];
      const attachmentRatios: number[] = [];
      
      // Clear any fixed markers to reset
      originalMarker.removeAttribute('data-refx-fixed');
      
      for (const scale of scales) {
        const markerId = scaleMarker(originalMarker, scale, svg);
        const marker = document.getElementById(markerId) as SVGMarkerElement;
        
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
