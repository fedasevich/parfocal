import { HttpResponse, http, type RequestHandler } from "msw";
import type { StudyTemplateDraft, StudyTemplateSummary, TemplateOffer } from "../generated/api.ts";
import { scenarioNow } from "./scenario.ts";

const added: StudyTemplateSummary[] = [];
const changes = new Map<string, Partial<StudyTemplateSummary>>();
const offered: TemplateOffer[] = [];

export const resetStudyTemplates = () => {
  added.length = 0;
  changes.clear();
  offered.length = 0;
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
  const addTemplate = (draft: StudyTemplateDraft): StudyTemplateSummary => {
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
    return template;
  };
  return [
    http.post("*/api/template-offers", async ({ request }) => {
      const draft = (await request.json()) as StudyTemplateDraft;
      const offer: TemplateOffer = {
        ...draft,
        id: `00000000-0000-4000-8070-${String(offered.length + 1).padStart(12, "0")}`,
        offered_by_user_id: "00000000-0000-4000-8000-000000000001",
        status: "pending",
        template_id: null,
        created_at: scenarioNow,
        decided_at: null,
      };
      offered.push(offer);
      return HttpResponse.json(offer, { status: 201 });
    }),
    http.get("*/api/template-offers", () =>
      HttpResponse.json(offered.filter((offer) => offer.status === "pending")),
    ),
    http.post("*/api/template-offers/:offerId/acceptance", ({ request }) => {
      const offer = offered.find((item) => item.id === idOf(request.url, 2));
      if (offer === undefined) return HttpResponse.json({ title: "Not found" }, { status: 404 });
      if (nameTaken(all(), offer.name)) return taken();
      offer.status = "accepted";
      return HttpResponse.json(
        addTemplate({
          name: offer.name,
          study_kind: offer.study_kind,
          blocks: offer.blocks,
          presets: offer.presets,
          ...(offer.format === undefined ? {} : { format: offer.format }),
        }),
      );
    }),
    http.post("*/api/template-offers/:offerId/decline", ({ request }) => {
      const offer = offered.find((item) => item.id === idOf(request.url, 2));
      if (offer === undefined) return HttpResponse.json({ title: "Not found" }, { status: 404 });
      offer.status = "declined";
      return new HttpResponse(null, { status: 204 });
    }),
    http.post("*/api/study-templates", async ({ request }) => {
      const draft = (await request.json()) as StudyTemplateDraft;
      if (nameTaken(all(), draft.name)) return taken();
      return HttpResponse.json(addTemplate(draft), { status: 201 });
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
