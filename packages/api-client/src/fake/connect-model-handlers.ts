import { HttpResponse, http } from "msw";
import { type LabModelDraft, labModelDraftSchema } from "../draft/connect-lab-model.ts";
import {
  type LabModelConnection,
  type LabModelTest,
  labModelConnectionSchema,
} from "../draft/get-lab-model-connection.ts";
import { type AiModel, aiModelSchema } from "../draft/list-ai-models.ts";
import { fakeConnectModelScene } from "./connect-model-scene.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { projectByCode, projects } from "./scenario.ts";
import { aiModels } from "./scenario-admin.ts";
import { failedTest, labServer, sampleTiles, sentClasses } from "./scenario-connect-model.ts";

const untested: LabModelTest = {
  outcome: "untested",
  sample_slide: labServer.sampleSlide,
  returns: [],
  answered_ms: null,
  server_software: null,
  tiles: [],
  missing_geometry: 0,
  model: null,
  classes: [],
};

function toLabModelTest(): LabModelTest {
  const scene = fakeConnectModelScene();
  if (scene === "failed") {
    return {
      ...untested,
      outcome: "not-contract",
      returns: failedTest.returns,
      answered_ms: failedTest.answeredMs,
      server_software: labServer.software,
      missing_geometry: failedTest.missingGeometry,
    };
  }
  if (scene === "untested") return untested;
  return {
    outcome: "follows-contract",
    sample_slide: labServer.sampleSlide,
    returns: ["Regions", "Cells"],
    answered_ms: sampleTiles[0]?.answeredMs ?? null,
    server_software: labServer.software,
    tiles: sampleTiles.map((tile) => ({
      label: tile.label,
      slide: tile.slide,
      answered_ms: tile.answeredMs,
      regions: tile.regions,
      cells: tile.cells,
      classes: tile.classes,
      outline: tile.outline,
    })),
    missing_geometry: 0,
    model: labServer.model,
    classes: sentClasses,
  };
}

export const toLabModelConnection = (): LabModelConnection =>
  labModelConnectionSchema.parse({
    address: labServer.address,
    host: labServer.host,
    sign_in: labServer.signIn,
    last_four: labServer.lastFour,
    tile_size: labServer.tileSize,
    magnification: labServer.magnification,
    tiles_at_once: labServer.tilesAtOnce,
    health_check_minutes: labServer.healthCheckMinutes,
    taxonomy: labServer.taxonomy,
    who_can_run: labServer.whoCanRun,
    project_ids: labServer.projects.map((code) => projectByCode(code).id),
    test: toLabModelTest(),
  });

const projectCodes = (ids: string[]) =>
  projects.filter((project) => ids.includes(project.id)).map((project) => project.code);

export function toConnectedModel(draft: LabModelDraft): AiModel {
  const seed = aiModels.find((model) => model.name === draft.name);
  const codes = projectCodes(draft.project_ids);
  const people = draft.who_can_run === "admins" ? "People with admin rights" : "Researchers";
  return aiModelSchema.parse({
    id: seed?.id ?? "00000000-0000-4000-8065-000000000099",
    name: draft.name,
    version: draft.version,
    source: "lab",
    catalogue_name: null,
    makes: seed?.makes ?? ["Cells"],
    description: seed?.description ?? "Typed cells",
    runs_on: `Your server · ${new URL(draft.address).host}`,
    who_can_run: codes.length > 0 ? `${people} in ${codes.join(", ")}` : people,
    result_sets: seed?.resultSets ?? 0,
    shown: true,
    status: "answering",
    latency_ms: sampleTiles[0]?.answeredMs ?? null,
  });
}

export const getGetLabModelConnectionMockHandler = (overrideResponse?: LabModelConnection) =>
  http.get("*/api/tenant/models/connection", () =>
    HttpResponse.json(overrideResponse ?? toLabModelConnection()),
  );

export const getConnectLabModelMockHandler = (overrideResponse?: AiModel) =>
  http.post("*/api/tenant/models", async ({ request }) => {
    if (overrideResponse) return HttpResponse.json(overrideResponse);
    const parsed = labModelDraftSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        { type: "about:blank", title: "The model is not complete", status: 422 },
        { status: 422 },
      );
    }
    return HttpResponse.json(toConnectedModel(parsed.data), { status: 201 });
  });

export const connectModelDraftOperations: DraftOperation[] = [
  {
    operationId: "getLabModelConnection",
    method: "get",
    path: "/api/tenant/models/connection",
    handler: () => getGetLabModelConnectionMockHandler(),
  },
  {
    operationId: "connectLabModel",
    method: "post",
    path: "/api/tenant/models",
    handler: () => getConnectLabModelMockHandler(),
  },
];
