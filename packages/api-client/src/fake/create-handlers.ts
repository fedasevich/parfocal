import { HttpResponse, http, type RequestHandler } from "msw";
import type { CaseDraft, ProjectDraft } from "../generated/api.ts";
import { toCaseDetail } from "./case-handlers.ts";
import { liveSecurityContact } from "./console-handlers.ts";
import {
  cases,
  type ProjectCode,
  projects,
  type ScenarioCase,
  type ScenarioProject,
  scenarioNow,
  uuid,
} from "./scenario.ts";
import { toProject } from "./scenario-handlers.ts";
import { fakeView } from "./view.ts";

const seededProjects = projects.length;
const seededCases = cases.length;

export const resetCreatedRecords = () => {
  for (const created of cases.slice(seededCases)) {
    const owner = projects.find((project) => project.code === created.project);
    if (owner) owner.counts.cases -= 1;
  }
  projects.length = seededProjects;
  cases.length = seededCases;
};

const problem = (status: number, title: string, code: string) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const nextProjectNumber = () =>
  Math.max(...projects.map((project) => Number(project.code.slice(1)))) + 1;

export const createdRecordHandlers = (): RequestHandler[] => [
  http.post("*/api/projects", async ({ request }) => {
    const draft = (await request.json()) as ProjectDraft;
    if (draft.privacy_mode === "clinical" && liveSecurityContact() === null) {
      return problem(
        409,
        "Set the workspace security contact before it holds clinical data",
        "security-contact-missing",
      );
    }
    const number = nextProjectNumber();
    const project: ScenarioProject = {
      code: `P${String(number).padStart(2, "0")}` as ProjectCode,
      id: uuid(3, number),
      name: draft.name,
      privacy: draft.privacy_mode ?? "de-identified",
      template: draft.template ?? "none",
      studyTemplate: "",
      taxonomy: draft.taxonomy === "pannuke" ? "PanNuke" : "Sentinel node",
      colour: draft.colour ?? 0,
      owner: fakeView().viewer,
      members: [fakeView().viewer],
      createdAt: scenarioNow,
      counts: { cases: 0, slides: 0, resultSets: 0, reviewedPercent: 0 },
    };
    projects.push(project);
    return HttpResponse.json(toProject(project), { status: 201 });
  }),
  http.post("*/api/cases", async ({ request }) => {
    const draft = (await request.json()) as CaseDraft;
    const project = projects.find((candidate) => candidate.id === draft.project_id);
    if (project === undefined) return problem(404, "Project not found", "not-found");
    if (draft.patient && project.privacy !== "clinical") {
      return problem(422, "Patient fields are only for clinical projects", "patient-not-allowed");
    }
    if (cases.some((item) => item.project === project.code && item.label === draft.label)) {
      return problem(409, "A case with this ID already exists", "case-exists");
    }
    const created: ScenarioCase = {
      id: uuid(4, 100 + cases.length),
      label: draft.label,
      project: project.code,
      specimen: draft.specimens?.[0]?.type ?? "",
      folder: "",
    };
    cases.push(created);
    project.counts.cases += 1;
    const detail = toCaseDetail(created.id);
    return detail === null
      ? problem(500, "The case was not saved", "internal")
      : HttpResponse.json(detail, { status: 201 });
  }),
];
