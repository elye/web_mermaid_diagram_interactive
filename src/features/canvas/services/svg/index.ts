/**
 * Barrel for low-level SVG DOM primitives. These are the ONLY modules that
 * read/write raw SVG attributes — everything upstream (routing, drag,
 * viewBox fit) uses their return values.
 */
export { parseTranslate, readTranslate, writeTranslate, cssEscape } from './transforms';
export { groupBBox, localBBox, fallbackBBox, groupPolygon } from './shapeBBox';
export { pathEndpoints, pathMidpoint } from './pathGeometry';
export { contrastColor, setImportantStyle } from './styleUtils';
