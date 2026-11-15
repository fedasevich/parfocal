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
  readonly set: (id: string, data: ArrayBuffer, counts: SetCounts) => boolean;
  readonly drop: (id: string) => void;
  readonly get: (id: string) => OverlaySet<Buffer> | undefined;
  readonly writes: () => number;
  readonly destroy: () => void;
}

export const smallestInstanceBuffer = 4096;

const wordBytes = 4;

export function instanceCapacity(bytes: number, limit = Number.POSITIVE_INFINITY): number {
  let capacity = smallestInstanceBuffer;
  while (capacity < bytes) capacity *= 2;
  return Math.min(capacity, Math.floor(limit / wordBytes) * wordBytes);
}

export function createOverlayBuffers<Buffer extends InstanceBufferLike>(
  device: InstanceDeviceLike<Buffer>,
  usage: number,
  maxBufferBytes = Number.POSITIVE_INFINITY,
): OverlayBuffers<Buffer> {
  const sets = new Map<string, OverlaySet<Buffer>>();
  let writes = 0;

  const drop = (id: string) => {
    sets.get(id)?.buffer.destroy();
    sets.delete(id);
  };

  return {
    set: (id, data, counts) => {
      if (data.byteLength > maxBufferBytes) {
        drop(id);
        return false;
      }
      const previous = sets.get(id);
      const fits = previous !== undefined && previous.capacity >= data.byteLength;
      if (previous && !fits) previous.buffer.destroy();
      const capacity = fits ? previous.capacity : instanceCapacity(data.byteLength, maxBufferBytes);
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
        pointOffset:
          segmentOffset + (counts.segments + (counts.repeats ?? 0)) * segmentInstanceBytes,
      });
      return true;
    },
    drop,
    get: (id) => sets.get(id),
    writes: () => writes,
    destroy: () => {
      for (const id of [...sets.keys()]) drop(id);
    },
  };
}
