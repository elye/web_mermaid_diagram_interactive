/**
 * Diagram types — canonical shape for nodes/edges/positions/styles used
 * across features and stores.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BBox extends Point, Size {}

export interface NodeMeta {
  id: string;
  label: string;
  bbox: BBox;
}

export interface EdgeMeta {
  id: string;
  sourceId: string | null;
  targetId: string | null;
}

export interface PositionOverride {
  x: number;
  y: number;
}

/** Which path shape an edge should use. */
export type EdgeLineStyle = 'curve' | 'straight' | 'orthogonal';

export interface StyleOverride {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontColor?: string;
  dashArray?: string;
  /** Line style for edge paths. Applies to edges only; ignored on nodes. */
  lineStyle?: EdgeLineStyle;
}

/**
 * A user-dragged waypoint on an edge, expressed as an offset from the
 * default midpoint in SVG coordinates.  Stored per edge-id.
 */
export interface EdgeWaypoint {
  /** Absolute SVG-space position of this control point. */
  x: number;
  y: number;
}

/**
 * Overrides the computed anchor point for one end of an edge.
 * Instead of picking the closest side automatically, the user can pin the
 * anchor to a specific point on the node's perimeter by specifying which
 * `side` and a fractional `offset` (0 = start of side, 1 = end of side).
 *
 * Sides: 'top' | 'right' | 'bottom' | 'left'
 * Offset: 0.5 = midpoint of side (the default behaviour).
 */
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';

export interface EdgeAnchorOverride {
  side: AnchorSide;
  /** Fraction along the chosen side: 0 = top/left corner, 1 = bottom/right corner. Default 0.5. */
  offset: number;
}

export interface Annotation {
  id: string;
  text: string;
  position: Point;
  style?: StyleOverride;
}

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}
