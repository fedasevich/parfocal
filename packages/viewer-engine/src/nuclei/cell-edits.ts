export class CellEdits {
  private readonly removed = new Set<number>();
  private readonly promoted = new Map<number, number>();
  private changes = 0;

  get version(): number {
    return this.changes;
  }

  get removedCount(): number {
    return this.removed.size;
  }

  get promotedCount(): number {
    return this.promoted.size;
  }

  remove(cellNumber: number): void {
    if (this.removed.has(cellNumber)) return;
    this.removed.add(cellNumber);
    this.changes++;
  }

  restore(cellNumber: number): void {
    if (this.removed.delete(cellNumber)) this.changes++;
  }

  promote(cellNumber: number, classIndex: number): void {
    if (this.promoted.get(cellNumber) === classIndex) return;
    this.promoted.set(cellNumber, classIndex);
    this.changes++;
  }

  unpromote(cellNumber: number): void {
    if (this.promoted.delete(cellNumber)) this.changes++;
  }

  isRemoved(cellNumber: number): boolean {
    return this.removed.has(cellNumber);
  }

  classOf(cellNumber: number, original: number): number {
    return this.promoted.get(cellNumber) ?? original;
  }

  isPromoted(cellNumber: number): boolean {
    return this.promoted.has(cellNumber);
  }

  removedNumbers(): readonly number[] {
    return [...this.removed];
  }

  promotions(): ReadonlyMap<number, number> {
    return this.promoted;
  }
}
