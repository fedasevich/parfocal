import { HttpResponse, http, type RequestHandler } from "msw";
import type { StudyTemplateDraft, StudyTemplateSummary } from "../generated/api.ts";
import { scenarioNow } from "./scenario.ts";

const added: StudyTemplateSummary[] = [];
const changes = new Map<string, Partial<StudyTemplateSummary>>();

export const resetStudyTemplates = () => {
  added.length = 0;
  changes.clear();
};

const nameTaken = (all: StudyTemplateSummary[], name: string, except?: string) =>
  all.some((item) => item.name.toLowerCase() === name.trim().toLowerCase() && item.id !== except);

export const mergedStudyTemplates = (seeded: StudyTemplateSummary[]): StudyTemplateSummary[] =>
  [...seeded, ...added].map((item) => ({ ...item, ...changes.get(item.id) }));

const idOf = (url: string, tail: number) => new URL(url).pathname.split("/").at(-tail) ?? "";

const taken = () =>
  HttpResponse.json(
    {
      type: "about:blank",
      title: "A study template with this name already exists",
      status: 409,
      code: "study-template-name-taken",
    },
    { status: 409 },
  );

export function studyTemplateHandlers(seeded: () => StudyTemplateSummary[]): RequestHandler[] {
  const all = () => mergedStudyTemplates(seeded());
  return [
    http.post("*/api/study-templates", async ({ request }) => {
      const draft = (await request.json()) as StudyTemplateDraft;
      if (nameTaken(all(), draft.name)) return taken();
      const template: StudyTemplateSummary = {
        ...draft,
        id: `00000000-0000-4000-8069-${String(added.length + 1).padStart(12, "0")}`,
        version: 1,
        built_in: null,
        retired_at: null,
        created_at: scenarioNow,
        version_created_at: scenarioNow,
        task_count: 0,
      };
      added.push(template);
      return HttpResponse.json(template, { status: 201 });
    }),
    http.put("*/api/study-templates/:templateId", async ({ request }) => {
      const id = idOf(request.url, 1);
      const current = all().find((item) => item.id === id);
      if (current === undefined) return HttpResponse.json({ title: "Not found" }, { status: 404 });
      const draft = (await request.json()) as StudyTemplateDraft;
      if (nameTaken(all(), draft.name, id)) return taken();
      const next = {
        ...current,
        ...draft,
        version: current.version + 1,
        version_created_at: scenarioNow,
      };
      changes.set(id, next);
      return HttpResponse.json(next);
    }),
    http.post("*/api/study-templates/:templateId/retire", ({ request }) => {
      const id = idOf(request.url, 2);
      const current = all().find((item) => item.id === id);
      if (current === undefined) return HttpResponse.json({ title: "Not found" }, { status: 404 });
      changes.set(id, { retired_at: scenarioNow });
      return HttpResponse.json({ ...current, retired_at: scenarioNow });
    }),
    http.post("*/api/study-templates/:templateId/restore", ({ request }) => {
      const id = idOf(request.url, 2);
      const current = all().find((item) => item.id === id);
      if (current === undefined) return HttpResponse.json({ title: "Not found" }, { status: 404 });
      changes.set(id, { retired_at: null });
      return HttpResponse.json({ ...current, retired_at: null });
    }),
  ];
}
