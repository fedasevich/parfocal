import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const annotationLayerSchema = z.object({
  key: z.string(),
  name: z.string(),
  class_name: z.string().nullable(),
  count: z.number().int().nonnegative(),
  parent: z.string().nullable(),
  locked: z.boolean(),
});

export type AnnotationLayer = z.infer<typeof annotationLayerSchema>;

export const annotationLayersSchema = z.object({
  slide_id: z.string(),
  layers: z.array(annotationLayerSchema),
  new_shapes_go_to: z.string(),
});

export type AnnotationLayers = z.infer<typeof annotationLayersSchema>;

export const getListAnnotationLayersUrl = (slideId: string) =>
  `/api/slides/${slideId}/annotation-layers`;

const draft = defineDraftQuery(
  "listAnnotationLayers",
  getListAnnotationLayersUrl,
  annotationLayersSchema,
);

export type listAnnotationLayersResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListAnnotationLayersQueryResult = listAnnotationLayersResponse;
export type ListAnnotationLayersQueryError = Problem;

export const listAnnotationLayers = (slideId: string, options?: DraftRequest) =>
  draft.fetcher([slideId], options);

export const getListAnnotationLayersQueryKey = (slideId: string) => draft.queryKey(slideId);

export const getListAnnotationLayersQueryOptions = <
  TData = listAnnotationLayersResponse,
  TError = Problem,
>(
  slideId: string,
  options?: DraftQueryOptions<listAnnotationLayersResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([slideId], options);

export const useListAnnotationLayers = <TData = listAnnotationLayersResponse, TError = Problem>(
  slideId: string,
  options?: DraftQueryOptions<listAnnotationLayersResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([slideId], options, queryClient);
