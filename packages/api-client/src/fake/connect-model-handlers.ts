import { HttpResponse, http, type RequestHandler } from "msw";
import {
  type LabModelConnection,
  type LabModelConnectionTest,
  labModelConnectionSchema,
} from "../draft/get-lab-model-connection.ts";
import type {
  LabModel,
  LabModelDraft,
  LabModelTest,
  LabModelTestRequest,
} from "../generated/api.ts";
import { fakeConnectModelScene } from "./connect-model-scene.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { projectByCode } from "./scenario.ts";
import { failedTest, labServer, sampleTiles, sentClasses } from "./scenario-connect-model.ts";

const untested: LabModelConnectionTest = {
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

const passingTest: LabModelTest = {
  outcome: "follows-contract",
  sample_slide: labServer.sampleSlide,
  returns: ["Regions", "Cells"],
  answered_ms: sampleTiles[0]?.answeredMs ?? 0,
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

const failingTest: LabModelTest = {
  ...passingTest,
  outcome: "not-contract",
  returns: failedTest.returns,
  answered_ms: failedTest.answeredMs,
  tiles: [],
  missing_geometry: failedTest.missingGeometry,
  model: null,
  classes: [],
};

export const brokenLabServer = "broken";

function toLabModelTest(): LabModelConnectionTest {
  const scene = fakeConnectModelScene();
  if (scene === "failed") return failingTest;
  if (scene === "untested") return untested;
  return passingTest;
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

export function toTestedLabModel(request: LabModelTestRequest): LabModelTest {
  return new URL(request.address).host.includes(brokenLabServer) ? failingTest : passingTest;
}

export function toConnectedModel(draft: LabModelDraft): LabModel {
  return {
    id: "00000000-0000-4000-8065-000000000099",
    name: draft.name,
    version: draft.version,
    address: draft.address,
    host: new URL(draft.address).host,
    sign_in: draft.sign_in,
    header_name: draft.sign_in === "header" ? (draft.header_name ?? null) : null,
    last_four: draft.secret ? draft.secret.slice(-4) : null,
    tile_size: draft.tile_size ?? 512,
    magnification: draft.magnification ?? 40,
    taxonomy: draft.taxonomy,
    class_map: draft.class_map,
    who_can_run: draft.who_can_run,
    project_ids: draft.project_ids,
    created_at: "2026-11-08T09:00:00Z",
  };
}

const incomplete = () =>
  HttpResponse.json(
    { type: "about:blank", title: "The model is not complete", status: 422 },
    { status: 422 },
  );

export function connectModelHandlers(): RequestHandler[] {
  return [
    http.post("*/api/tenant/models/test", async ({ request }) => {
      const body = (await request.json()) as LabModelTestRequest | null;
      if (!body?.address) return incomplete();
      return HttpResponse.json(toTestedLabModel(body));
    }),
    http.post("*/api/tenant/models", async ({ request }) => {
      const body = (await request.json()) as LabModelDraft | null;
      if (!body?.name || !body.version || !body.address) return incomplete();
      return HttpResponse.json(toConnectedModel(body), { status: 201 });
    }),
  ];
}

export const getGetLabModelConnectionMockHandler = (overrideResponse?: LabModelConnection) =>
  http.get("*/api/tenant/models/connection", () =>
    HttpResponse.json(overrideResponse ?? toLabModelConnection()),
  );

export const connectModelDraftOperations: DraftOperation[] = [
  {
    operationId: "getLabModelConnection",
    method: "get",
    path: "/api/tenant/models/connection",
    handler: () => getGetLabModelConnectionMockHandler(),
  },
];
