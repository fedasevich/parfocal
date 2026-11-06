import type { CellChunk } from "./cell-chunk.ts";

export const DEFAULT_VERTEX_BUDGET = 4_000_000;

export class ChunkCache {
  private readonly resident = new Map<number, CellChunk>();
  private heldVertices = 0;
  private heldBytes = 0;
  readonly vertexBudget: number;

  constructor(vertexBudget: number = DEFAULT_VERTEX_BUDGET) {
    this.vertexBudget = vertexBudget;
  }

  get size(): number {
    return this.resident.size;
  }

  get vertices(): number {
    return this.heldVertices;
  }

  get bytes(): number {
    return this.heldBytes;
  }

  has(index: number): boolean {
    return this.resident.has(index);
  }

  peek(index: number): CellChunk | undefined {
    return this.resident.get(index);
  }

  get(index: number): CellChunk | undefined {
    const chunk = this.resident.get(index);
    if (chunk) this.touch(index);
    return chunk;
  }

  touch(index: number): void {
    const chunk = this.resident.get(index);
    if (!chunk) return;
    this.resident.delete(index);
    this.resident.set(index, chunk);
  }

  put(chunk: CellChunk): void {
    if (this.resident.has(chunk.index)) return;
    this.resident.set(chunk.index, chunk);
    this.heldVertices += chunk.vertices;
    this.heldBytes += chunk.byteLength;
  }

  evict(keep: ReadonlySet<number>): number {
    let evicted = 0;
    for (const [index, chunk] of this.resident) {
      if (this.heldVertices <= this.vertexBudget) break;
      if (keep.has(index)) continue;
      this.resident.delete(index);
      this.heldVertices -= chunk.vertices;
      this.heldBytes -= chunk.byteLength;
      evicted++;
    }
    return evicted;
  }

  chunks(): IterableIterator<CellChunk> {
    return this.resident.values();
  }

  clear(): void {
    this.resident.clear();
    this.heldVertices = 0;
    this.heldBytes = 0;
  }
}
