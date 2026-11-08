import type { UnsureCell } from "../../viewer/viewer-engine.ts";
import type { Point } from "./paged-review.ts";

export const FIELD_STEP_X = 800;
export const FIELD_STEP_Y = 500;
export const FOLLOW_LIMIT = 600;
export const MAX_FIELDS = 10;

export const fieldKeyOf = (centre: Point) =>
  `${Math.round(centre.x / FIELD_STEP_X)}:${Math.round(centre.y / FIELD_STEP_Y)}`;

export const fieldCentreOf = (key: string): Point => {
  const [column, row] = key.split(":").map(Number);
  return { x: (column ?? 0) * FIELD_STEP_X, y: (row ?? 0) * FIELD_STEP_Y };
};

export class WorkingSet {
  private readonly known = new Map<number, UnsureCell>();
  private readonly fields = new Map<string, number[]>();
  private readonly index = new Set<number>();
  private readonly pinned = new Set<number>();

  hasField(key: string): boolean {
    return this.fields.has(key);
  }

  addField(key: string, cells: readonly UnsureCell[]): void {
    this.fields.delete(key);
    this.fields.set(
      key,
      cells.map((cell) => cell.number),
    );
    for (const cell of cells) this.known.set(cell.number, cell);
    while (this.fields.size > MAX_FIELDS) {
      const oldest = this.fields.keys().next().value;
      if (oldest === undefined) break;
      this.fields.delete(oldest);
    }
    this.prune();
  }

  touch(key: string): void {
    const numbers = this.fields.get(key);
    if (numbers === undefined) return;
    this.fields.delete(key);
    this.fields.set(key, numbers);
  }

  setIndex(cells: readonly UnsureCell[]): void {
    this.index.clear();
    for (const cell of cells) {
      this.index.add(cell.number);
      this.known.set(cell.number, cell);
    }
    this.prune();
  }

  pin(objects: Iterable<string>): void {
    for (const object of objects) {
      const number = Number(object.slice(1));
      if (Number.isInteger(number) && this.known.has(number)) this.pinned.add(number);
    }
  }

  cells(): UnsureCell[] {
    return [...this.known.values()];
  }

  size(): number {
    return this.known.size;
  }

  indexSize(): number {
    return this.index.size;
  }

  has(object: string): boolean {
    return this.known.has(Number(object.slice(1)));
  }

  private prune(): void {
    const wanted = new Set<number>([...this.index, ...this.pinned]);
    for (const numbers of this.fields.values()) for (const number of numbers) wanted.add(number);
    for (const number of this.known.keys()) if (!wanted.has(number)) this.known.delete(number);
  }
}
