import { HttpResponse, http, type RequestHandler } from "msw";
import { getListModelVisibilityMockHandler } from "../generated/api.msw.ts";
import type { ModelShown } from "../generated/api.ts";
import { people } from "./scenario.ts";
import { aiModels } from "./scenario-admin.ts";

const initiallyHidden = aiModels
  .filter((model) => model.source === "parfocal" && !model.shown)
  .flatMap((model) => (model.catalogueName ? [model.catalogueName] : []));

let hidden = new Set<string>(initiallyHidden);

export function isModelHidden(name: string): boolean {
  return hidden.has(name);
}

export function resetHiddenModels(): void {
  hidden = new Set(initiallyHidden);
}

const parfocalModels = () =>
  aiModels.flatMap((model) =>
    model.source === "parfocal" && model.catalogueName
      ? [{ name: model.catalogueName, title: model.name }]
      : [],
  );

const shownOf = (model: { name: string; title: string }): ModelShown => ({
  ...model,
  shown: !hidden.has(model.name),
  hidden_by: hidden.has(model.name) ? people.DH.id : null,
});

export const toModelVisibility = (): ModelShown[] => parfocalModels().map(shownOf);

function changed(name: string, show: boolean) {
  const model = parfocalModels().find((item) => item.name === name);
  if (model === undefined) {
    return HttpResponse.json(
      {
        type: "about:blank",
        code: "model-not-found",
        title: "No Parfocal model has this name",
        status: 400,
      },
      { status: 400 },
    );
  }
  if (show) hidden.delete(name);
  else hidden.add(name);
  return HttpResponse.json(shownOf(model));
}

export function hiddenModelHandlers(): RequestHandler[] {
  return [
    getListModelVisibilityMockHandler(() => toModelVisibility()),
    http.put<{ name: string }>("*/api/tenant/hidden-models/:name", ({ params }) =>
      changed(params.name, false),
    ),
    http.delete<{ name: string }>("*/api/tenant/hidden-models/:name", ({ params }) =>
      changed(params.name, true),
    ),
  ];
}
