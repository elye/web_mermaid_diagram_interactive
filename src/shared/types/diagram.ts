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

export interface StyleOverride {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontColor?: string;
  dashArray?: string;
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
