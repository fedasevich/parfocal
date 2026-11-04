export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface PolygonBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly starts: Uint32Array;
  readonly colors: Uint8Array;
  readonly holeStarts: Uint32Array;
  readonly indices: Uint32Array;
}

export interface PathBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly starts: Uint32Array;
  readonly colors: Uint8Array;
}

export interface PointBatch {
  readonly count: number;
  readonly positions: Float32Array;
  readonly colors: Uint8Array;
}
