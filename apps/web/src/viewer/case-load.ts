import type {
  CaseDetail,
  PatientDetail,
  Project,
  ResultSet,
  ReviewDecision,
  ReviewTaskDetail,
  SlideRow,
  TaskKind,
} from "@parfocal/api-client";

export type CaseLoadInput = {
  readonly project: Pick<Project, "id" | "code" | "name" | "privacy_mode">;
  readonly slideId: string;
  readonly slides: readonly SlideRow[];
  readonly caseDetail: CaseDetail | undefined;
  readonly resultSets: readonly ResultSet[];
  readonly task: ReviewTaskDetail | undefined;
  readonly decisions: readonly ReviewDecision[];
};

export type CaseLoad = {
  readonly project: { readonly id: string; readonly code: string; readonly name: string };
  readonly clinical: boolean;
  readonly slide: { readonly id: string; readonly label: string } | null;
  readonly case: {
    readonly id: string;
    readonly label: string;
    readonly slideIds: readonly string[];
  } | null;
  readonly patient: PatientDetail | null;
  readonly resultSets: readonly ResultSet[];
  readonly task: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly kind: TaskKind;
  } | null;
  readonly decisions: readonly ReviewDecision[];
};

export function shapeCaseLoad(input: CaseLoadInput): CaseLoad {
  const clinical = input.project.privacy_mode === "clinical";
  const slide = input.slides.find((candidate) => candidate.id === input.slideId);
  const caseRef = slide?.case_id ? { id: slide.case_id, label: slide.case_label ?? "" } : null;
  const detail =
    caseRef !== null && input.caseDetail?.id === caseRef.id ? input.caseDetail : undefined;
  return {
    project: { id: input.project.id, code: input.project.code, name: input.project.name },
    clinical,
    slide: slide ? { id: slide.id, label: slide.label } : null,
    case: caseRef
      ? {
          id: caseRef.id,
          label: caseRef.label,
          slideIds: detail
            ? detail.slides.map((item) => item.id)
            : input.slides.filter((item) => item.case_id === caseRef.id).map((item) => item.id),
        }
      : null,
    patient: clinical ? (detail?.patient ?? null) : null,
    resultSets: input.resultSets,
    task: input.task
      ? { id: input.task.id, code: input.task.code, name: input.task.name, kind: input.task.kind }
      : null,
    decisions: input.task ? input.decisions : [],
  };
}
