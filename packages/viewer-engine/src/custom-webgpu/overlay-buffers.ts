import { type SetCounts, segmentInstanceBytes, triangleInstanceBytes } from "./protocol.ts";

export interface InstanceBufferLike {
  destroy(): void;
}

export interface InstanceDeviceLike<Buffer extends InstanceBufferLike> {
  createBuffer(descriptor: { size: number; usage: number }): Buffer;
  readonly queue: {
    writeBuffer(buffer: Buffer, offset: number, data: ArrayBuffer): void;
  };
}

export interface OverlaySet<Buffer> extends SetCounts {
  readonly buffer: Buffer;
  readonly capacity: number;
  readonly segmentOffset: number;
  readonly pointOffset: number;
}

export interface OverlayBuffers<Buffer> {
  readonly set: (id: string, data: ArrayBuffer, counts: SetCounts) => void;
  readonly drop: (id: string) => void;
  readonly get: (id: string) => OverlaySet<Buffer> | undefined;
  readonly writes: () => number;
  readonly destroy: () => void;
}

export const smallestInstanceBuffer = 4096;

export function instanceCapacity(bytes: number): number {
  let capacity = smallestInstanceBuffer;
  while (capacity < bytes) capacity *= 2;
  return capacity;
}

export function createOverlayBuffers<Buffer extends InstanceBufferLike>(
  device: InstanceDeviceLike<Buffer>,
  usage: number,
): OverlayBuffers<Buffer> {
  const sets = new Map<string, OverlaySet<Buffer>>();
  let writes = 0;

  const drop = (id: string) => {
    sets.get(id)?.buffer.destroy();
    sets.delete(id);
  };

  return {
    set: (id, data, counts) => {
      const previous = sets.get(id);
      const fits = previous !== undefined && previous.capacity >= data.byteLength;
      if (previous && !fits) previous.buffer.destroy();
      const capacity = fits ? previous.capacity : instanceCapacity(data.byteLength);
      const buffer = fits ? previous.buffer : device.createBuffer({ size: capacity, usage });
      if (data.byteLength > 0) {
        device.queue.writeBuffer(buffer, 0, data);
        writes += 1;
      }
      const segmentOffset = counts.triangles * triangleInstanceBytes;
      sets.set(id, {
        ...counts,
        buffer,
        capacity,
        segmentOffset,
        pointOffset: segmentOffset + counts.segments * segmentInstanceBytes,
      });
    },
    drop,
    get: (id) => sets.get(id),
    writes: () => writes,
    destroy: () => {
      for (const id of [...sets.keys()]) drop(id);
    },
  };
}
