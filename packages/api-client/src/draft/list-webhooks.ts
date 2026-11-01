import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const webhookSchema = z.object({
  id: z.string(),
  name: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  events: z.array(z.string()),
  calls_today: z.number().int().nonnegative(),
  rejected_today: z.number().int().nonnegative(),
});

export type Webhook = z.infer<typeof webhookSchema>;

export const webhookListSchema = z.array(webhookSchema);

export const getListWebhooksUrl = () => "/api/tenant/webhooks";

const draft = defineDraftQuery("listWebhooks", getListWebhooksUrl, webhookListSchema);

export type listWebhooksResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListWebhooksQueryResult = listWebhooksResponse;
export type ListWebhooksQueryError = Problem;

export const listWebhooks = (options?: DraftRequest) => draft.fetcher([], options);

export const getListWebhooksQueryKey = () => draft.queryKey();

export const getListWebhooksQueryOptions = <TData = listWebhooksResponse, TError = Problem>(
  options?: DraftQueryOptions<listWebhooksResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListWebhooks = <TData = listWebhooksResponse, TError = Problem>(
  options?: DraftQueryOptions<listWebhooksResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
