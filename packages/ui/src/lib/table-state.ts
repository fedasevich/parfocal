export type SortDirection = "ascending" | "descending";

export type TableSort<Key extends string = string> = { key: Key; direction: SortDirection };

export type PickState = "none" | "some" | "all";

export type SortValue = string | number | Date | null | undefined;

export function nextSort<Key extends string>(
  current: TableSort<Key> | null,
  key: Key,
  first: SortDirection = "ascending",
): TableSort<Key> {
  if (current?.key !== key) return { key, direction: first };
  return { key, direction: current.direction === "ascending" ? "descending" : "ascending" };
}

export function sortDirectionOf<Key extends string>(
  sort: TableSort<Key> | null,
  key: Key,
): SortDirection | undefined {
  return sort?.key === key ? sort.direction : undefined;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function compareValues(a: SortValue, b: SortValue): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return collator.compare(String(a), String(b));
}

export function sortRows<Row, Key extends string>(
  rows: readonly Row[],
  sort: TableSort<Key> | null,
  value: (row: Row, key: Key) => SortValue,
): Row[] {
  if (!sort) return [...rows];
  const sign = sort.direction === "ascending" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = value(left.row, sort.key);
      const b = value(right.row, sort.key);
      const aEmpty = a === null || a === undefined || a === "";
      const bEmpty = b === null || b === undefined || b === "";
      const order = aEmpty || bEmpty ? compareValues(a, b) : sign * compareValues(a, b);
      return order || left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function pickStateOf(picked: ReadonlySet<string>, ids: readonly string[]): PickState {
  const count = ids.filter((id) => picked.has(id)).length;
  if (count === 0) return "none";
  return count === ids.length ? "all" : "some";
}

export function togglePick(picked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function togglePickAll(picked: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(picked);
  if (pickStateOf(picked, ids) === "all") for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return next;
}
