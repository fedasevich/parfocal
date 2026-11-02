import { HttpResponse, http, type RequestHandler } from "msw";
import type { CaseDetail } from "../generated/api.ts";
import { cases, projects, slides } from "./scenario.ts";

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
    slides: slides
      .filter((slide) => slide.caseLabel === found.label && slide.project === found.project)
      .map((slide) => ({
        id: slide.id,
        label: slide.label,
        block_id: null,
        barcode: null,
        stain: slide.stain,
        level: null,
        restricted_images: [],
      })),
  };
};

export const caseHandlers = (): RequestHandler[] => [
  http.get<{ caseId: string }>("*/api/cases/:caseId", ({ params }) => {
    const detail = toCaseDetail(params.caseId);
    return detail === null ? undefined : HttpResponse.json(detail);
  }),
];
