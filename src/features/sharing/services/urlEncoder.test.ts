import { describe, it, expect } from 'vitest';
import { encodeSource, decodeSource } from './urlEncoder';

describe('urlEncoder', () => {
  it('round-trips a Mermaid source through deflate+base64url', () => {
    const source = 'flowchart TD\n  A[Start] --> B[End]';
    const encoded = encodeSource(source);
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('+');
    expect(decodeSource(encoded)).toBe(source);
  });

  it('handles unicode content', () => {
    const source = '# 🧜‍♀️ MermaidFlow\nflowchart\n  A --> B';
    expect(decodeSource(encodeSource(source))).toBe(source);
  });
});
