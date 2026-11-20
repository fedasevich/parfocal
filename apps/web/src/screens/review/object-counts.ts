import type { ReviewObject } from "@parfocal/api-client";

export function sampledCellsOf(objects: readonly Pick<ReviewObject, "kind">[]): number {
  return objects.filter((item) => item.kind === "cell").length;
}
