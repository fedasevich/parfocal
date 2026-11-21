import { HttpResponse, http, type RequestHandler } from "msw";
import type {
  AppliedFilters,
  DatasetFilters,
  DatasetOrigin,
  DatasetSummary,
  DatasetVersion,
  FreezeRequest,
  SlideCounts,
} from "../generated/api.ts";
import { slides } from "./scenario.ts";
import { annotateStubTaskId } from "./scenario-review.ts";
import { annotateTaskClasses, signedOffSlidesOf } from "./shared-layer-handlers.ts";

const checkedOrigins: DatasetOrigin[] = ["human", "ai-confirmed", "ai-edited"];
const allOrigins: DatasetOrigin[] = [...checkedOrigins, "ai-unchecked"];

type FakeObject = { readonly origin: DatasetOrigin; readonly classId: string | null };

const tumour = annotateTaskClasses[0]?.id ?? null;
const lymphocyte = annotateTaskClasses[1]?.id ?? null;
const mitosis = annotateTaskClasses[2]?.id ?? null;

const objectsOfASlide: FakeObject[] = [
  ...Array.from({ length: 3 }, () => ({ origin: "human" as const, classId: tumour })),
  ...Array.from({ length: 5 }, () => ({ origin: "ai-confirmed" as const, classId: tumour })),
  ...Array.from({ length: 2 }, () => ({ origin: "ai-edited" as const, classId: lymphocyte })),
  { origin: "ai-edited", classId: null },
  ...Array.from({ length: 4 }, () => ({ origin: "ai-unchecked" as const, classId: mitosis })),
];

const versionsByTask = new Map<string, { version: DatasetVersion; bytes: Uint8Array }[]>();

const signedSlidesOf = (taskId: string): string[] =>
  taskId === annotateStubTaskId ? signedOffSlidesOf(taskId) : [];

const applied = (filters: DatasetFilters): AppliedFilters => ({
  origins: checkedOrigins.filter(
    (origin) => filters.origins == null || filters.origins.includes(origin),
  ),
  class_ids: filters.class_ids == null ? null : [...filters.class_ids].sort(),
  slide_ids: filters.slide_ids == null ? null : [...filters.slide_ids].sort(),
  include_unchecked: filters.include_unchecked ?? false,
});

const zeroOrigins = (): Record<DatasetOrigin, number> =>
  Object.fromEntries(allOrigins.map((origin) => [origin, 0])) as Record<DatasetOrigin, number>;

const classKey = (classId: string | null) => classId ?? "none";

function slideCounts(slideId: string, chosen: AppliedFilters): SlideCounts {
  const objects = zeroOrigins();
  const classes: Record<string, number> = {};
  let uncheckedLeftOut = 0;
  let filteredOut = 0;
  for (const item of objectsOfASlide) {
    if (item.origin === "ai-unchecked" && !chosen.include_unchecked) {
      uncheckedLeftOut += 1;
      continue;
    }
    const originKept = item.origin === "ai-unchecked" || chosen.origins.includes(item.origin);
    const classKept = chosen.class_ids === null || chosen.class_ids.includes(item.classId ?? "");
    if (!originKept || !classKept) {
      filteredOut += 1;
      continue;
    }
    objects[item.origin] += 1;
    classes[classKey(item.classId)] = (classes[classKey(item.classId)] ?? 0) + 1;
  }
  return {
    slide_id: slideId,
    label: slides.find((slide) => slide.id === slideId)?.label ?? "",
    objects,
    classes,
    unchecked_left_out: uncheckedLeftOut,
    filtered_out: filteredOut,
  };
}

function summaryOf(taskId: string, filters: DatasetFilters): DatasetSummary {
  const chosen = applied(filters);
  const signed = signedSlidesOf(taskId);
  const picked = signed.filter((id) => chosen.slide_ids === null || chosen.slide_ids.includes(id));
  const perSlide = picked.map((id) => slideCounts(id, chosen));
  const objects = zeroOrigins();
  const classes: Record<string, number> = {};
  for (const entry of perSlide) {
    for (const origin of allOrigins) objects[origin] += entry.objects[origin] ?? 0;
    for (const [key, count] of Object.entries(entry.classes)) {
      classes[key] = (classes[key] ?? 0) + count;
    }
  }
  return {
    filters: chosen,
    signed_off_slides: signed.length,
    objects,
    classes,
    unchecked_left_out: perSlide.reduce((sum, entry) => sum + entry.unchecked_left_out, 0),
    filtered_out: perSlide.reduce((sum, entry) => sum + entry.filtered_out, 0),
    slides: perSlide,
  };
}

const refused = (status: number, code: string, title: string) =>
  HttpResponse.json(
    { type: `https://parfocal.eu/problems/${code}`, title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const nothingSignedOff = () =>
  refused(
    409,
    "nothing-signed-off",
    "Sign off at least one slide of this task before exporting the dataset",
  );

const filtersOf = (url: URL): DatasetFilters => {
  const list = (name: string) => {
    const values = url.searchParams.getAll(name);
    return values.length === 0 ? null : values;
  };
  const unchecked = url.searchParams.get("include_unchecked");
  return {
    origins: list("origin") as DatasetOrigin[] | null,
    class_ids: list("class_id"),
    slide_ids: list("slide_id"),
    include_unchecked: unchecked === null ? null : unchecked === "true",
  };
};

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

export const datasetHandlers = (): RequestHandler[] => [
  http.get<{ taskId: string }>("*/api/review-tasks/:taskId/dataset", ({ params, request }) => {
    if (signedSlidesOf(params.taskId).length === 0) return nothingSignedOff();
    return HttpResponse.json(summaryOf(params.taskId, filtersOf(new URL(request.url))));
  }),
  http.get<{ taskId: string }>("*/api/review-tasks/:taskId/dataset-versions", ({ params }) =>
    HttpResponse.json(
      [...(versionsByTask.get(params.taskId) ?? [])].reverse().map((item) => item.version),
    ),
  ),
  http.post<{ taskId: string }>(
    "*/api/review-tasks/:taskId/dataset-versions",
    async ({ params, request }) => {
      if (signedSlidesOf(params.taskId).length === 0) return nothingSignedOff();
      const body = (await request.json()) as FreezeRequest;
      const counts = summaryOf(params.taskId, body.filters ?? {});
      const total = Object.values(counts.objects).reduce((sum, count) => sum + (count ?? 0), 0);
      if (counts.slides.length === 0 || total === 0) {
        return refused(
          409,
          "nothing-chosen",
          "Choose at least one signed off slide and one object before freezing a version",
        );
      }
      const listed = versionsByTask.get(params.taskId) ?? [];
      const number = listed.length + 1;
      const bytes = new TextEncoder().encode(
        `PK fake dataset version ${number} of ${params.taskId} ${JSON.stringify(counts)}`,
      );
      const version: DatasetVersion = {
        id: crypto.randomUUID(),
        number,
        note: (body.note ?? "").trim(),
        filters: counts.filters,
        counts,
        sha256: await sha256Of(bytes),
        bytes: bytes.length,
        created_at: new Date().toISOString(),
        created_by: "Dana Hale",
      };
      versionsByTask.set(params.taskId, [...listed, { version, bytes }]);
      return HttpResponse.json(version, { status: 201 });
    },
  ),
  http.get<{ taskId: string; number: string }>(
    "*/api/review-tasks/:taskId/dataset-versions/:number",
    ({ params }) => {
      const found = (versionsByTask.get(params.taskId) ?? []).find(
        (item) => String(item.version.number) === params.number,
      );
      if (found === undefined) return refused(404, "not-found", "Dataset version not found");
      return new HttpResponse(found.bytes, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="parfocal-AT-21-dataset-v${params.number}.zip"`,
          "x-checksum-sha256": found.version.sha256,
        },
      });
    },
  ),
];
