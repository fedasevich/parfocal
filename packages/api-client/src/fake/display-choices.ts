import { HttpResponse, http, type RequestHandler } from "msw";
import type {
  DisplayChoice,
  DisplayPreset,
  DisplaySettings,
  MyDisplay,
  PresetChange,
  PresetDraft,
} from "../generated/api.ts";
import { taskDisplayFor } from "./display-settings.ts";

const taskDefault = "Task default";

const seeded: Record<string, { name: string; settings: DisplaySettings }[]> = {
  "RT-14": [
    { name: "Tumor first", settings: { colour_by: "class", order: "largest-first" } },
    { name: "Dots, no IDs", settings: { draw_as: "dots", id_labels: false, confidence: "word" } },
  ],
};

type Choice = { preset_id: string | null; settings: DisplaySettings };

const choices = new Map<string, Choice>();
const presets = new Map<string, DisplayPreset>();
const seededTasks = new Set<string>();
let counter = 0;

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json({ type: "about:blank", title, status, code }, { status });

const now = "2026-10-15T10:00:00+02:00";

const nextId = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};

const seed = (taskId: string, code: string) => {
  if (seededTasks.has(taskId)) return;
  seededTasks.add(taskId);
  for (const item of seeded[code] ?? []) {
    const id = nextId();
    presets.set(id, {
      id,
      name: item.name,
      task_id: taskId,
      settings: item.settings,
      created_at: now,
      updated_at: now,
    });
  }
};

const usable = (taskId: string) =>
  [...presets.values()].filter((item) => item.task_id === null || item.task_id === taskId);

const myDisplay = (taskId: string, code: string): MyDisplay => {
  seed(taskId, code);
  const task = taskDisplayFor(code);
  const list = usable(taskId);
  const choice = choices.get(taskId);
  const named = list.find((item) => item.id === choice?.preset_id);
  return {
    task,
    preset_id: named?.id ?? null,
    preset: named?.name ?? taskDefault,
    settings: choice?.settings ?? task.defaults ?? {},
    presets: list,
  };
};

const fieldOf: Record<string, keyof DisplaySettings> = {
  confidence: "confidence",
  heatmap: "heatmap",
  "score-cutoff": "score_cutoff",
  "other-sets": "other_sets",
  order: "order",
};

const lockedChanges = (code: string, settings: DisplaySettings) => {
  const task = taskDisplayFor(code);
  return Object.keys(task.locks ?? {}).filter((lock) => {
    const field = fieldOf[lock];
    return (
      field !== undefined &&
      JSON.stringify(settings[field]) !== JSON.stringify(task.defaults?.[field])
    );
  });
};

const nameTaken = (name: string, except?: string) => {
  if (name.toLowerCase() === taskDefault.toLowerCase()) return true;
  return [...presets.values()].some(
    (item) => item.id !== except && item.name.toLowerCase() === name.toLowerCase(),
  );
};

const nameProblem = (name: string) =>
  problem(409, "display-preset-name-taken", `You already have a preset called ${name}`);

export const presetInForce = (taskId: string) => {
  const preset = choices.get(taskId)?.preset_id;
  return preset ? (presets.get(preset)?.name ?? null) : null;
};

export function displayChoiceHandlers(codeOf: (taskId: string) => string): RequestHandler[] {
  return [
    http.get<{ taskId: string }>("*/api/review-tasks/:taskId/my-display", ({ params }) =>
      HttpResponse.json(myDisplay(params.taskId, codeOf(params.taskId))),
    ),
    http.put<{ taskId: string }>(
      "*/api/review-tasks/:taskId/my-display",
      async ({ request, params }) => {
        const body = (await request.json()) as DisplayChoice;
        const code = codeOf(params.taskId);
        const changed = lockedChanges(code, body.settings);
        if (changed.length) {
          return problem(409, "display-setting-locked", `The task locks ${changed.join(", ")}`);
        }
        choices.set(params.taskId, { preset_id: body.preset_id ?? null, settings: body.settings });
        return HttpResponse.json(myDisplay(params.taskId, code));
      },
    ),
    http.get("*/api/display-presets", ({ request }) => {
      const taskId = new URL(request.url).searchParams.get("task_id");
      return HttpResponse.json(taskId ? usable(taskId) : [...presets.values()]);
    }),
    http.post("*/api/display-presets", async ({ request }) => {
      const body = (await request.json()) as PresetDraft;
      if (nameTaken(body.name)) return nameProblem(body.name);
      const id = nextId();
      const saved: DisplayPreset = {
        id,
        name: body.name,
        task_id: body.task_id ?? null,
        settings: body.settings,
        created_at: now,
        updated_at: now,
      };
      presets.set(id, saved);
      return HttpResponse.json(saved, { status: 201 });
    }),
    http.patch<{ presetId: string }>(
      "*/api/display-presets/:presetId",
      async ({ request, params }) => {
        const found = presets.get(params.presetId);
        if (!found) return problem(404, "not-found", "Preset not found");
        const body = (await request.json()) as PresetChange;
        if (body.name && nameTaken(body.name, found.id)) return nameProblem(body.name);
        const changed = {
          ...found,
          name: body.name ?? found.name,
          settings: body.settings ?? found.settings,
        };
        presets.set(found.id, changed);
        return HttpResponse.json(changed);
      },
    ),
    http.delete<{ presetId: string }>("*/api/display-presets/:presetId", ({ params }) => {
      presets.delete(params.presetId);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
