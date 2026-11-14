import type { PolygonBatch } from "../overlay/batch-types.ts";
import { type PolygonInput, polygonBatchFromRings } from "../overlay/batches.ts";

export const BLOCK_POLYGONS = 16_384;

export type Lineage = string;

export interface SceneBlock {
  readonly id: string;
  readonly lineage: Lineage;
  readonly batch: PolygonBatch;
}

interface Block {
  readonly index: number;
  readonly units: number[];
  polygons: number;
  dirty: boolean;
  built: PolygonBatch | null;
}

interface Segment {
  readonly block: number;
  parts: PolygonBatch[];
  seq: number;
}

interface Run {
  readonly segments: Map<number, Segment>;
  readonly blocks: Block[];
}

const EMPTY: PolygonBatch = polygonBatchFromRings([]);

export function mergePolygonBatches(batches: readonly PolygonBatch[]): PolygonBatch {
  const present = batches.filter((batch) => batch.count > 0);
  if (present.length === 0) return EMPTY;
  if (present.length === 1) return present[0] ?? EMPTY;
  let count = 0;
  let vertices = 0;
  let holes = 0;
  let indices = 0;
  for (const batch of present) {
    count += batch.count;
    vertices += batch.positions.length / 2;
    holes += batch.holeStarts.length;
    indices += batch.indices.length;
  }
  const merged = {
    count,
    positions: new Float32Array(vertices * 2),
    starts: new Uint32Array(count + 1),
    colors: new Uint8Array(count * 4),
    holeStarts: new Uint32Array(holes),
    indices: new Uint32Array(indices),
  };
  let polygon = 0;
  let vertex = 0;
  let hole = 0;
  let index = 0;
  for (const batch of present) {
    merged.positions.set(batch.positions, vertex * 2);
    merged.colors.set(batch.colors, polygon * 4);
    for (let item = 1; item <= batch.count; item++) {
      merged.starts[polygon + item] = (batch.starts[item] ?? 0) + vertex;
    }
    for (let item = 0; item < batch.holeStarts.length; item++) {
      merged.holeStarts[hole + item] = (batch.holeStarts[item] ?? 0) + vertex;
    }
    for (let item = 0; item < batch.indices.length; item++) {
      merged.indices[index + item] = (batch.indices[item] ?? 0) + vertex;
    }
    polygon += batch.count;
    vertex += batch.positions.length / 2;
    hole += batch.holeStarts.length;
    index += batch.indices.length;
  }
  return merged;
}

export class StreamedScene {
  private readonly runs = new Map<Lineage, Run>();
  private readonly blockPolygons: number;
  private changes = 0;

  constructor(blockPolygons = BLOCK_POLYGONS) {
    this.blockPolygons = blockPolygons;
  }

  get version(): number {
    return this.changes;
  }

  lineages(): Lineage[] {
    return [...this.runs.keys()];
  }

  has(lineage: Lineage, unit: number): boolean {
    return this.runs.get(lineage)?.segments.has(unit) ?? false;
  }

  seqOf(lineage: Lineage, unit: number): number | undefined {
    return this.runs.get(lineage)?.segments.get(unit)?.seq;
  }

  append(
    lineage: Lineage,
    unit: number,
    polygons: readonly PolygonInput[],
    part = 0,
    seq = 0,
  ): void {
    const run = this.runOf(lineage);
    const batch = polygonBatchFromRings(polygons);
    const existing = run.segments.get(unit);
    if (existing === undefined) {
      const block = this.openBlock(run);
      block.units.push(unit);
      block.polygons += batch.count;
      block.dirty = true;
      run.segments.set(unit, { block: block.index, parts: [batch], seq });
    } else {
      const block = run.blocks[existing.block];
      if (block === undefined) return;
      const before = existing.parts.reduce((sum, item) => sum + item.count, 0);
      existing.parts = part === 0 ? [batch] : [...existing.parts, batch];
      existing.seq = Math.max(existing.seq, seq);
      const after = existing.parts.reduce((sum, item) => sum + item.count, 0);
      block.polygons += after - before;
      block.dirty = true;
    }
    this.changes++;
  }

  drop(lineage: Lineage): void {
    if (this.runs.delete(lineage)) this.changes++;
  }

  keepOnly(lineage: Lineage): void {
    for (const other of this.lineages()) if (other !== lineage) this.drop(other);
  }

  polygons(lineage?: Lineage): number {
    let total = 0;
    for (const [key, run] of this.runs) {
      if (lineage !== undefined && key !== lineage) continue;
      for (const block of run.blocks) total += block.polygons;
    }
    return total;
  }

  dirtyBlocks(): number {
    let dirty = 0;
    for (const run of this.runs.values()) {
      for (const block of run.blocks) if (block.dirty) dirty++;
    }
    return dirty;
  }

  rebuildNext(): boolean {
    for (const run of this.runs.values()) {
      for (const block of run.blocks) {
        if (!block.dirty && block.built !== null) continue;
        block.built = mergePolygonBatches(
          block.units.flatMap((unit) => run.segments.get(unit)?.parts ?? []),
        );
        block.dirty = false;
        return true;
      }
    }
    return false;
  }

  blocks(): SceneBlock[] {
    const blocks: SceneBlock[] = [];
    for (const [lineage, run] of this.runs) {
      for (const block of run.blocks) {
        if (block.built === null || block.built.count === 0) continue;
        blocks.push({ id: `${lineage}:${block.index}`, lineage, batch: block.built });
      }
    }
    return blocks;
  }

  rebuild(): SceneBlock[] {
    let merged = this.rebuildNext();
    while (merged) merged = this.rebuildNext();
    return this.blocks();
  }

  merged(): PolygonBatch {
    return mergePolygonBatches(this.rebuild().map((block) => block.batch));
  }

  private runOf(lineage: Lineage): Run {
    const found = this.runs.get(lineage);
    if (found) return found;
    const created: Run = { segments: new Map(), blocks: [] };
    this.runs.set(lineage, created);
    return created;
  }

  private openBlock(run: Run): Block {
    const last = run.blocks[run.blocks.length - 1];
    if (last !== undefined && last.polygons < this.blockPolygons) return last;
    const created: Block = {
      index: run.blocks.length,
      units: [],
      polygons: 0,
      dirty: true,
      built: null,
    };
    run.blocks.push(created);
    return created;
  }
}
