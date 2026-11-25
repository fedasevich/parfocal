import type { ResultSet } from "@parfocal/api-client";

export type EmptyReason = "no-tissue" | "nothing-found" | "unknown";

export type ResultSetSummary =
  | { kind: "importing" }
  | { kind: "failed"; code: string | null }
  | { kind: "empty"; reason: EmptyReason }
  | { kind: "objects"; cells: number; regions: number; zones: number };

const emptyReasons: Record<string, EmptyReason> = {
  "run-found-no-tissue": "no-tissue",
  "run-found-nothing": "nothing-found",
};

type Counted = Pick<
  ResultSet,
  "status" | "error_code" | "cell_count" | "region_count" | "zone_count"
>;

export function summaryOf(set: Counted): ResultSetSummary {
  if (set.status === "importing") return { kind: "importing" };
  if (set.status === "failed") return { kind: "failed", code: set.error_code };
  const cells = set.cell_count ?? 0;
  const regions = set.region_count ?? 0;
  const zones = set.zone_count ?? 0;
  if (cells + regions + zones === 0) {
    return { kind: "empty", reason: emptyReasons[set.error_code ?? ""] ?? "unknown" };
  }
  return { kind: "objects", cells, regions, zones };
}
