import { useListMySlides } from "@parfocal/api-client";
import { okData } from "../placeholder.tsx";

export function useResultsSlide(projectId: string, wanted: boolean) {
  const rows =
    okData(useListMySlides({ project_id: projectId }, { query: { enabled: wanted } }).data)
      ?.slides ?? [];
  return rows.find((row) => row.result_sets.length > 1)?.id;
}
