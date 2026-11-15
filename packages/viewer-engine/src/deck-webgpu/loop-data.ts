interface LoopAttribute {
  readonly value: Float32Array | Uint8Array | Uint32Array;
  readonly size: number;
}

export interface LoopPathData {
  readonly length: number;
  readonly startIndices?: Uint32Array;
  readonly attributes: Readonly<Record<string, LoopAttribute | Uint32Array>>;
}

export function isLoopPathData(data: unknown): data is LoopPathData {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as Partial<LoopPathData>;
  return (
    candidate.startIndices instanceof Uint32Array &&
    typeof candidate.attributes === "object" &&
    candidate.attributes !== null &&
    "getPath" in candidate.attributes
  );
}

export function webGpuPathType(pathType: unknown, data: unknown): "open" | null {
  return pathType === "loop" && isLoopPathData(data) ? "open" : null;
}
