import type { ResultSet } from "@parfocal/api-client";
import { type ResultSetChoice, type ScopeKind, shortDate } from "./model.ts";

const resultSetKeys = ["cam", "sam"] as const;

const groupKeyOf = (set: ResultSet) =>
  [set.name, set.model_version ?? "", set.source, set.source_file ?? ""].join("|");

export type GroupedResultSets = {
  choices: ResultSetChoice[];
  groupOf: Map<string, string>;
};

export function groupResultSets(sets: readonly ResultSet[]): GroupedResultSets {
  const members = new Map<string, ResultSet[]>();
  for (const set of sets) {
    const key = groupKeyOf(set);
    members.set(key, [...(members.get(key) ?? []), set]);
  }
  const groupOf = new Map<string, string>();
  const choices = [...members.values()].map((group, index): ResultSetChoice => {
    const first = group[0] as ResultSet;
    for (const set of group) groupOf.set(set.id, first.id);
    const brand = first.name.split(" ")[0] ?? first.name;
    const version = first.model_version ?? "";
    const date = shortDate(first.produced_at ?? first.created_at);
    return {
      id: first.id,
      key: resultSetKeys[index] ?? "sam",
      label: `${first.name} ${version}`.trim(),
      short: `${brand} ${version}`.trim(),
      detail:
        first.source === "import"
          ? `Imported ${date} from ${first.source_file ?? "a file"}`
          : `Run here ${date}`,
      slideSets: Object.fromEntries(group.map((set) => [set.slide_id, set.id])),
      objects: {
        regions: group.some((set) => set.region_count > 0),
        cells: group.some((set) => set.cell_count > 0),
        zones: group.some((set) => set.zone_count > 0),
      },
    };
  });
  return { choices, groupOf };
}

const needs: Record<ScopeKind, keyof ResultSetChoice["objects"] | null> = {
  regions: "regions",
  cells: "cells",
  low: "cells",
  unsure: "zones",
  roi: null,
};

const asked = (scope: readonly ScopeKind[]) => scope.filter((kind) => needs[kind] !== null);

export function missingObjects(scope: readonly ScopeKind[], objects: ResultSetChoice["objects"]) {
  return asked(scope).filter((kind) => {
    const need = needs[kind];
    return need !== null && !objects[need];
  }).length;
}

const fits = (scope: readonly ScopeKind[], objects: ResultSetChoice["objects"]) =>
  asked(scope).length === 0 || missingObjects(scope, objects) < asked(scope).length;

export function templateFor<
  T extends { id: string; retired: boolean; preset: { scope: ScopeKind[] } },
>(templates: readonly T[], preferredId: string, objects: ResultSetChoice["objects"]): string {
  const usable = templates.filter((template) => !template.retired);
  const preferred = usable.find((template) => template.id === preferredId);
  if (preferred && fits(preferred.preset.scope, objects)) return preferred.id;
  const fitting = usable
    .filter((template) => fits(template.preset.scope, objects))
    .sort(
      (a, b) => missingObjects(a.preset.scope, objects) - missingObjects(b.preset.scope, objects),
    );
  return fitting[0]?.id ?? preferredId;
}
