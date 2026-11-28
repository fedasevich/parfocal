import type { ProjectModel, ProjectSlide } from "@parfocal/api-client";
import type { Blocker } from "@parfocal/ui/components/before-you-list";
import type { ModelGroup } from "@parfocal/ui/components/model-picker";
import type { TokenItem } from "@parfocal/ui/components/token-field";
import { slideThumbUrl } from "../slide-thumb-url.ts";
import { makesLabel } from "./model.ts";

const slideName = (slide: ProjectSlide) =>
  slide.case === null ? slide.label : `${slide.label} · ${slide.stain}`;

export function slideItems(
  slides: ProjectSlide[],
  setNames: Map<string, string>,
  model: ProjectModel | undefined,
): TokenItem[] {
  return slides.map((slide) => {
    const names = slide.result_set_ids.map((id) => setNames.get(id) ?? "");
    const has = model !== undefined && names.includes(model.title);
    return {
      id: slide.id,
      name: slideName(slide),
      thumbnail: slideThumbUrl(slide.id),
      find: slide.case?.label ?? "Loose",
      sub: `${slide.case ? `Case ${slide.case.label}` : "Loose"} · ${names.length ? names.join(", ") : "no results yet"}`,
      ...(has ? { end: "has this set", endTone: "warn" as const } : {}),
    };
  });
}

export const servedModels = (models: ProjectModel[]) =>
  models.filter((model) => model.serving !== "not-served");

export function startingModel(models: ProjectModel[], wanted: string | undefined): string | null {
  const served = servedModels(models);
  return (served.find((model) => model.id === wanted) ?? served[0])?.id ?? null;
}

export function modelGroups(models: ProjectModel[]): ModelGroup[] {
  const option = (model: ProjectModel) => ({
    id: model.id,
    title: model.title,
    description: model.description,
    makes: model.makes.map((item) => makesLabel[item]),
    perSlide:
      model.seconds_per_mm2 != null
        ? "Time and cost follow the tissue"
        : `${model.minutes_per_slide} min a slide`,
    offline: model.serving === "offline",
  });
  return [
    {
      title: "Parfocal models",
      options: servedModels(models)
        .filter((model) => model.host === "parfocal")
        .map(option),
    },
    {
      title: "Your lab's models",
      options: servedModels(models)
        .filter((model) => model.host === "lab")
        .map(option),
    },
  ];
}

export function runBlockers(pickedCount: number, model: ProjectModel | undefined): Blocker[] {
  return [
    ...(pickedCount ? [] : [{ id: "slides", text: "Pick at least one slide.", goTo: "Slides" }]),
    ...(model ? [] : [{ id: "model", text: "Pick a model.", goTo: "Model" }]),
    ...(model?.serving === "not-served"
      ? [
          {
            id: "not-served",
            text: `${model.title} has no worker yet. Pick another model.`,
            goTo: "Model",
          },
        ]
      : []),
    ...(model?.serving === "offline"
      ? [
          {
            id: "offline",
            text: `${model.title} is offline. Pick another model or try again later.`,
            goTo: "Model",
          },
        ]
      : []),
  ];
}

export function startingSlides(
  requested: string[] | undefined,
  defaults: string[],
  slides: ProjectSlide[],
): string[] {
  if (requested === undefined) return defaults;
  const known = new Set(slides.map((slide) => slide.id));
  const kept = requested.filter((id) => known.has(id));
  return kept.length ? kept : defaults;
}
