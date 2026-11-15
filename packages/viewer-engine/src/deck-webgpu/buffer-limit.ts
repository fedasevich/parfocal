export const polygonVertexBytes = 24;

export class WebGpuBufferLimitError extends Error {
  readonly layerId: string;
  readonly bytes: number;
  readonly limit: number;

  constructor(layerId: string, bytes: number, limit: number) {
    super(
      `The ${layerId} layer needs a ${bytes} byte vertex buffer, above the WebGPU adapter limit of ${limit} bytes, so it is not drawn`,
    );
    this.name = "WebGpuBufferLimitError";
    this.layerId = layerId;
    this.bytes = bytes;
    this.limit = limit;
  }
}

interface BinaryAttribute {
  readonly value?: { readonly length: number };
  readonly size?: number;
}

export interface BufferSizedLayer {
  readonly id: string;
  readonly props: {
    readonly data?: unknown;
  };
}

export function polygonBufferBytes(layer: BufferSizedLayer): number {
  const data = layer.props.data as
    | { readonly attributes?: { readonly getPolygon?: BinaryAttribute } }
    | null
    | undefined;
  const polygon = data?.attributes?.getPolygon;
  if (!polygon?.value) return 0;
  const size = polygon.size ?? 2;
  return Math.ceil(polygon.value.length / size) * polygonVertexBytes;
}

export interface BufferLimitSplit<Layer> {
  readonly drawable: Layer[];
  readonly rejected: WebGpuBufferLimitError[];
}

export function splitByBufferLimit<Layer extends BufferSizedLayer>(
  layers: readonly Layer[],
  maxBufferSize: number,
): BufferLimitSplit<Layer> {
  const drawable: Layer[] = [];
  const rejected: WebGpuBufferLimitError[] = [];
  for (const layer of layers) {
    const bytes = polygonBufferBytes(layer);
    if (bytes > maxBufferSize)
      rejected.push(new WebGpuBufferLimitError(layer.id, bytes, maxBufferSize));
    else drawable.push(layer);
  }
  return { drawable, rejected };
}
