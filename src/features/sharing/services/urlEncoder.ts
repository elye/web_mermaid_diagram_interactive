/**
 * urlEncoder — encode/decode Mermaid source in the URL hash.
 *
 * Uses `pako` deflate + base64 (URL-safe). Similar in spirit to mermaid.live.
 */
import { deflate, inflate } from 'pako';
import { useDiagramStore } from '@/stores/diagramStore';

const HASH_PREFIX = '#mf:';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeSource(src: string): string {
  const compressed = deflate(new TextEncoder().encode(src));
  return toBase64Url(compressed);
}

export function decodeSource(encoded: string): string {
  const bytes = fromBase64Url(encoded);
  const raw = inflate(bytes);
  return new TextDecoder().decode(raw);
}

export function encodeToUrlHash(): string {
  const src = useDiagramStore.getState().source;
  const encoded = encodeSource(src);
  const url = new URL(window.location.href);
  url.hash = `${HASH_PREFIX}${encoded}`;
  history.replaceState(null, '', url.toString());
  return url.toString();
}

export function loadFromUrlHash(): boolean {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return false;
  try {
    const src = decodeSource(hash.slice(HASH_PREFIX.length));
    useDiagramStore.getState().hydrate({ source: src, positionOverrides: {} });
    return true;
  } catch {
    return false;
  }
}
