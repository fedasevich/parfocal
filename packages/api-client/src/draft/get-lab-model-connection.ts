import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const LabModelSignIn = { none: "none", token: "token", header: "header" } as const;

export const LabModelTestOutcome = {
  untested: "untested",
  "follows-contract": "follows-contract",
  "not-contract": "not-contract",
} as const;

export const tileOutlineSchema = z.object({
  regions: z.array(z.array(z.tuple([z.number(), z.number()]))),
  cells: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      rx: z.number(),
      ry: z.number(),
      class: z.string(),
    }),
  ),
});

export type TileOutline = z.infer<typeof tileOutlineSchema>;

export const sampleTileSchema = z.object({
  label: z.string(),
  slide: z.string(),
  answered_ms: z.number().int().nonnegative(),
  regions: z.number().int().nonnegative(),
  cells: z.number().int().nonnegative(),
  classes: z.number().int().nonnegative(),
  outline: tileOutlineSchema,
});

export type SampleTile = z.infer<typeof sampleTileSchema>;

export const sentClassSchema = z.object({
  name: z.string(),
  cells: z.number().int().nonnegative(),
  suggested: z.string().nullable(),
});

export type SentClass = z.infer<typeof sentClassSchema>;

export const labModelTestSchema = z.object({
  outcome: z.enum(LabModelTestOutcome),
  sample_slide: z.string(),
  returns: z.array(z.string()),
  answered_ms: z.number().int().nonnegative().nullable(),
  server_software: z.string().nullable(),
  tiles: z.array(sampleTileSchema),
  missing_geometry: z.number().int().nonnegative(),
  model: z.object({ name: z.string(), version: z.string() }).nullable(),
  classes: z.array(sentClassSchema),
});

export type LabModelTest = z.infer<typeof labModelTestSchema>;

export const labModelConnectionSchema = z.object({
  address: z.url(),
  host: z.string(),
  sign_in: z.enum(LabModelSignIn),
  last_four: z.string(),
  tile_size: z.number().int().positive(),
  magnification: z.number().int().positive(),
  tiles_at_once: z.number().int().positive(),
  health_check_minutes: z.number().int().positive(),
  taxonomy: z.string(),
  who_can_run: z.enum(["admins", "researchers"]),
  project_ids: z.array(z.string()),
  test: labModelTestSchema,
});

export type LabModelConnection = z.infer<typeof labModelConnectionSchema>;

export const getGetLabModelConnectionUrl = () => "/api/tenant/models/connection";

const draft = defineDraftQuery(
  "getLabModelConnection",
  getGetLabModelConnectionUrl,
  labModelConnectionSchema,
);

export type getLabModelConnectionResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetLabModelConnectionQueryResult = getLabModelConnectionResponse;
export type GetLabModelConnectionQueryError = Problem;

export const getLabModelConnection = (options?: DraftRequest) => draft.fetcher([], options);

export const getGetLabModelConnectionQueryKey = () => draft.queryKey();

export const getGetLabModelConnectionQueryOptions = <
  TData = getLabModelConnectionResponse,
  TError = Problem,
>(
  options?: DraftQueryOptions<getLabModelConnectionResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useGetLabModelConnection = <TData = getLabModelConnectionResponse, TError = Problem>(
  options?: DraftQueryOptions<getLabModelConnectionResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
