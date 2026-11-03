import { HttpResponse, http, type RequestHandler } from "msw";
import type { CaseDetail, SlideDetail, SlideDetailsChange, SlideOrder } from "../generated/api.ts";
import { cases, projects, type ScenarioSlide, scenarioNow, slides } from "./scenario.ts";

type SlideEdit = Partial<Pick<SlideDetail, "label" | "stain" | "block_id" | "level">>;

const slideEdits = new Map<string, SlideEdit>();
const caseOrders = new Map<string, string[]>();

export const resetSlideEdits = () => {
  slideEdits.clear();
  caseOrders.clear();
};

const problem = (status: number, title: string, code: string) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const toSlideDetail = (slide: ScenarioSlide): SlideDetail => ({
  id: slide.id,
  label: slide.label,
  block_id: null,
  barcode: null,
  stain: slide.stain,
  level: null,
  restricted_images: [],
  ...slideEdits.get(slide.id),
});

const slidesOfCase = (caseId: string): ScenarioSlide[] => {
  const found = cases.find((item) => item.id === caseId);
  if (found === undefined) return [];
  const inCase = slides.filter(
    (slide) => slide.caseLabel === found.label && slide.project === found.project,
  );
  const order = caseOrders.get(caseId) ?? [];
  const rank = (slide: ScenarioSlide) => {
    const at = order.indexOf(slide.id);
    return at === -1 ? order.length + inCase.indexOf(slide) : at;
  };
  return [...inCase].sort((first, second) => rank(first) - rank(second));
};

export const toCaseDetail = (caseId: string): CaseDetail | null => {
  const found = cases.find((item) => item.id === caseId);
  if (found === undefined) return null;
  const project = projects.find((item) => item.code === found.project);
  if (project === undefined) return null;
  const index = cases.indexOf(found) + 1;
  return {
    id: found.id,
    project_id: project.id,
    label: found.label,
    source: "manual",
    patient:
      project.privacy === "clinical"
        ? {
            id: `fake-patient-${index}`,
            name: `Fake Patient ${index}`,
            mrn: `FAKE-${String(index).padStart(4, "0")}`,
            birth_date: null,
            sex: "unknown",
            age_years: null,
          }
        : null,
    specimens: [],
    slides: slidesOfCase(caseId).map(toSlideDetail),
  };
};

const caseOfSlide = (slide: ScenarioSlide) =>
  cases.find((item) => item.label === slide.caseLabel && item.project === slide.project);

export const caseHandlers = (): RequestHandler[] => [
  http.get("*/api/cases", ({ request }) => {
    const projectId = new URL(request.url).searchParams.get("project_id");
    const summaries = cases.flatMap((item) => {
      const project = projects.find((candidate) => candidate.code === item.project);
      if (project === undefined || (projectId !== null && project.id !== projectId)) return [];
      return [{ id: item.id, project_id: project.id, label: item.label, created_at: scenarioNow }];
    });
    return HttpResponse.json(summaries);
  }),
  http.get<{ caseId: string }>("*/api/cases/:caseId", ({ params }) => {
    const detail = toCaseDetail(params.caseId);
    return detail === null ? undefined : HttpResponse.json(detail);
  }),
  http.patch<{ slideId: string }>("*/api/slides/:slideId", async ({ params, request }) => {
    const slide = slides.find((item) => item.id === params.slideId);
    if (slide === undefined) return problem(404, "Slide not found", "not-found");
    const change = (await request.json()) as SlideDetailsChange;
    const before = toSlideDetail(slide);
    if (change.label != null && change.label !== before.label) {
      const owner = caseOfSlide(slide);
      const siblings = owner ? slidesOfCase(owner.id) : [];
      if (
        siblings.some((item) => item.id !== slide.id && toSlideDetail(item).label === change.label)
      )
        return problem(
          409,
          "Another slide in this case already has this label",
          "slide-label-taken",
        );
    }
    const edit: SlideEdit = { ...slideEdits.get(slide.id) };
    if (change.label != null) edit.label = change.label;
    if (change.stain != null) edit.stain = change.stain;
    if (change.block_id !== undefined) edit.block_id = change.block_id;
    if (change.level !== undefined) edit.level = change.level;
    slideEdits.set(slide.id, edit);
    return HttpResponse.json(toSlideDetail(slide));
  }),
  http.put<{ caseId: string }>("*/api/cases/:caseId/slide-order", async ({ params, request }) => {
    const current = slidesOfCase(params.caseId).map((slide) => slide.id);
    if (toCaseDetail(params.caseId) === null) return problem(404, "Case not found", "not-found");
    const { slide_ids: listed } = (await request.json()) as SlideOrder;
    if (new Set(listed).size !== listed.length || listed.some((id) => !current.includes(id)))
      return problem(
        400,
        "Every slide in the order must belong to this case, once",
        "slide-outside-case",
      );
    caseOrders.set(params.caseId, [...listed, ...current.filter((id) => !listed.includes(id))]);
    return HttpResponse.json(toCaseDetail(params.caseId));
  }),
];
