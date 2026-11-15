type AttributeValue = Float32Array | Uint8Array | Uint32Array;

interface LoopAttribute {
  readonly value: AttributeValue;
  readonly size: number;
  readonly normalized?: boolean;
}

export interface LoopPathData {
  readonly length: number;
  readonly startIndices?: Uint32Array;
  readonly attributes: Readonly<Record<string, LoopAttribute | Uint32Array>>;
}

export const closedRingMinimumVertices = 5;

const thirdVertex = 2;

function isPerVertex(
  attribute: LoopAttribute | Uint32Array,
  vertices: number,
): attribute is LoopAttribute {
  return (
    !(attribute instanceof Uint32Array) && attribute.value.length === vertices * attribute.size
  );
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

export function withThirdClosingVertex(data: LoopPathData): LoopPathData {
  const starts = data.startIndices;
  if (starts === undefined) return data;
  const rings = starts.length - 1;
  const total = starts[rings] ?? 0;
  const countOf = (ring: number): number => (starts[ring + 1] ?? 0) - (starts[ring] ?? 0);
  const closes = (ring: number): boolean => countOf(ring) >= closedRingMinimumVertices;
  const extendedStarts = new Uint32Array(rings + 1);
  for (let ring = 0; ring < rings; ring++) {
    extendedStarts[ring + 1] = (extendedStarts[ring] ?? 0) + countOf(ring) + (closes(ring) ? 1 : 0);
  }
  const extendedTotal = extendedStarts[rings] ?? 0;
  if (extendedTotal === total) return data;
  const attributes: Record<string, LoopAttribute | Uint32Array> = {};
  for (const [name, attribute] of Object.entries(data.attributes)) {
    if (!isPerVertex(attribute, total)) {
      attributes[name] = attribute;
      continue;
    }
    const { size, value } = attribute;
    const extended = new (value.constructor as new (length: number) => AttributeValue)(
      extendedTotal * size,
    );
    for (let ring = 0; ring < rings; ring++) {
      const from = (starts[ring] ?? 0) * size;
      const to = (extendedStarts[ring] ?? 0) * size;
      const length = countOf(ring) * size;
      extended.set(value.subarray(from, from + length), to);
      if (closes(ring)) {
        extended.set(
          value.subarray(from + thirdVertex * size, from + (thirdVertex + 1) * size),
          to + length,
        );
      }
    }
    attributes[name] = { ...attribute, value: extended };
  }
  return { length: data.length, startIndices: extendedStarts, attributes };
}
