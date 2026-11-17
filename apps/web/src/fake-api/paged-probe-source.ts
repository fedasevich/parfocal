import type { PagedCellSource } from "@parfocal/api-client/fake/paged-cell-source";

export async function pagedProbeSource(cells: number): Promise<PagedCellSource> {
  const generator = await import("@parfocal/api-client/fake/paged-cell-source");
  return generator.pagedCellSource({ cells });
}
