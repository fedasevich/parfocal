import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";

export const typerClasses = ["tumor", "stroma", "immune", "other"] as const;

export type TyperClass = (typeof typerClasses)[number];

const share = z.number().min(0).max(1);

export const outlineTypesDraftSchema = z.object({
  outlines: z
    .array(z.object({ points: z.array(z.number()).min(6) }))
    .min(1)
    .max(500),
});

export type OutlineTypesDraft = z.infer<typeof outlineTypesDraftSchema>;

export const typedOutlineSchema = z.object({
  probabilities: z.object({ tumor: share, stroma: share, immune: share, other: share }),
  type: z.enum(typerClasses),
  alternatives: z.array(z.enum(typerClasses)),
  foreground: share,
});

export type TypedOutline = z.infer<typeof typedOutlineSchema>;

export const outlineTypesSchema = z.object({
  slide_id: z.string(),
  typer: z.string(),
  version: z.string(),
  calibrated: z.boolean(),
  outlines: z.array(typedOutlineSchema),
});

export type OutlineTypes = z.infer<typeof outlineTypesSchema>;

export type TypeOutlinesMutationVariables = { slideId: string; data: OutlineTypesDraft };

export const getTypeOutlinesUrl = (slideId: string) => `/api/slides/${slideId}/outline-types`;

const draft = defineDraftMutation(
  "typeOutlines",
  {
    method: "POST",
    url: ({ slideId }: TypeOutlinesMutationVariables) => getTypeOutlinesUrl(slideId),
    body: ({ data }: TypeOutlinesMutationVariables) => data,
  },
  outlineTypesSchema,
);

export type typeOutlinesResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type TypeOutlinesMutationError = Problem;

export const typeOutlines = (slideId: string, data: OutlineTypesDraft, options?: DraftRequest) =>
  draft.fetcher({ slideId, data }, options);

export const getTypeOutlinesMutationKey = () => draft.mutationKey();

export const getTypeOutlinesMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    typeOutlinesResponse,
    TypeOutlinesMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useTypeOutlines = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    typeOutlinesResponse,
    TypeOutlinesMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
