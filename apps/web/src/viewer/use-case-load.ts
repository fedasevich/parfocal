import {
  useGetCase,
  useGetProject,
  useGetReviewTask,
  useListMySlides,
  useListSlideResultSets,
  useListVerdicts,
} from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import { type CaseLoad, shapeCaseLoad } from "./case-load.ts";

export type CaseLoadState =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly load: CaseLoad };

export function useCaseLoad(
  projectId: string,
  slideId: string,
  taskId: string | undefined,
): CaseLoadState {
  const projectQuery = useGetProject(projectId);
  const slidesQuery = useListMySlides({ project_id: projectId });
  const resultSetsQuery = useListSlideResultSets(slideId);
  const project = okData(projectQuery.data);
  const slides = okData(slidesQuery.data)?.slides;
  const caseId = slides?.find((slide) => slide.id === slideId)?.case_id ?? undefined;
  const caseQuery = useGetCase(caseId ?? "", { query: { enabled: caseId !== undefined } });
  const wantsTask = taskId !== undefined;
  const taskQuery = useGetReviewTask(taskId ?? "", { query: { enabled: wantsTask } });
  const decisionsQuery = useListVerdicts(taskId ?? "", slideId, undefined, {
    query: { enabled: wantsTask },
  });
  if (projectQuery.isError || slidesQuery.isError) return { state: "failed" };
  if (project === undefined || slides === undefined) return { state: "loading" };
  return {
    state: "ready",
    load: shapeCaseLoad({
      project,
      slideId,
      slides,
      caseDetail: okData(caseQuery.data),
      resultSets: okData(resultSetsQuery.data) ?? [],
      task: okData(taskQuery.data),
      decisions: okData(decisionsQuery.data) ?? [],
    }),
  };
}
