import type { ResultSet } from "@parfocal/api-client";

export type ResultSetStates = {
  readonly importing: readonly string[];
  readonly failed: readonly string[];
};

const nameOf = (set: Pick<ResultSet, "name" | "model_version">) =>
  set.model_version ? `${set.name} ${set.model_version}` : set.name;

export function resultSetStates(
  sets: readonly Pick<ResultSet, "name" | "model_version" | "status">[],
): ResultSetStates | null {
  const importing = sets.filter((set) => set.status === "importing").map(nameOf);
  const failed = sets.filter((set) => set.status === "failed").map(nameOf);
  return importing.length === 0 && failed.length === 0 ? null : { importing, failed };
}
