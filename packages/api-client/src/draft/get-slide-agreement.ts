import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const slideAgreementSchema = z.object({
  task_id: z.string(),
  slide_id: z.string(),
  with_user_id: z.string().nullable(),
  agree: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type SlideAgreement = z.infer<typeof slideAgreementSchema>;

export const getGetSlideAgreementUrl = (taskId: string, slideId: string) =>
  `/api/review-tasks/${taskId}/slides/${slideId}/agreement`;

const draft = defineDraftQuery("getSlideAgreement", getGetSlideAgreementUrl, slideAgreementSchema);

export type getSlideAgreementResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetSlideAgreementQueryResult = getSlideAgreementResponse;
export type GetSlideAgreementQueryError = Problem;

export const getSlideAgreement = (taskId: string, slideId: string, options?: DraftRequest) =>
  draft.fetcher([taskId, slideId], options);

export const getGetSlideAgreementQueryKey = (taskId: string, slideId: string) =>
  draft.queryKey(taskId, slideId);

export const getGetSlideAgreementQueryOptions = <
  TData = getSlideAgreementResponse,
  TError = Problem,
>(
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<getSlideAgreementResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([taskId, slideId], options);

export const useGetSlideAgreement = <TData = getSlideAgreementResponse, TError = Problem>(
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<getSlideAgreementResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([taskId, slideId], options, queryClient);
