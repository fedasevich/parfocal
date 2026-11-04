import {
  type QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
} from "@tanstack/react-query";
import type { z } from "zod";
import { type ApiResponse, apiFetch } from "../fetcher.ts";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest, DraftResponse } from "./define.ts";
import { draftMeta } from "./support.ts";

export type DraftMutationOptions<Response, Variables, TError, TContext> = {
  mutation?: UseMutationOptions<Response, TError, Variables, TContext>;
  request?: DraftRequest;
};

type DraftMutationShape<Variables> = {
  method: "POST" | "PUT" | "DELETE";
  url: (variables: Variables) => string;
  body?: (variables: Variables) => unknown;
};

export function defineDraftMutation<Variables, Schema extends z.ZodType>(
  operationId: string,
  shape: DraftMutationShape<Variables>,
  schema: Schema,
) {
  type Response = DraftResponse<z.infer<Schema>>;

  const fetcher = async (variables: Variables, options?: DraftRequest): Promise<Response> => {
    const body = shape.body?.(variables);
    const response = await apiFetch<ApiResponse<unknown>>(shape.url(variables), {
      ...options,
      method: shape.method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
    return { ...response, status: 200, data: schema.parse(response.data) };
  };

  const mutationKey = () => [operationId] as const;

  const mutationOptions = <TError = Problem, TContext = unknown>(
    options?: DraftMutationOptions<Response, Variables, TError, TContext>,
  ): UseMutationOptions<Response, TError, Variables, TContext> => {
    const { mutation, request } = options ?? {};
    return {
      mutationKey: mutationKey(),
      mutationFn: (variables: Variables) => fetcher(variables, request),
      meta: draftMeta(operationId),
      ...mutation,
    };
  };

  const useDraftMutation = <TError = Problem, TContext = unknown>(
    options?: DraftMutationOptions<Response, Variables, TError, TContext>,
    queryClient?: QueryClient,
  ): UseMutationResult<Response, TError, Variables, TContext> =>
    useMutation(mutationOptions(options), queryClient);

  return { fetcher, mutationKey, mutationOptions, useDraftMutation };
}
