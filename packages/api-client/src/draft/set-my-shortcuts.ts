import type { QueryClient } from "@tanstack/react-query";
import type { Problem } from "../generated/api.ts";
import type { DraftRequest } from "./define.ts";
import { type DraftMutationOptions, defineDraftMutation } from "./define-mutation.ts";
import { type ShortcutSettings, shortcutSettingsSchema } from "./get-my-settings.ts";

export type SetMyShortcutsMutationVariables = { data: ShortcutSettings };

export const getSetMyShortcutsUrl = () => "/api/me/shortcuts";

const draft = defineDraftMutation(
  "setMyShortcuts",
  {
    method: "PUT",
    url: () => getSetMyShortcutsUrl(),
    body: ({ data }: SetMyShortcutsMutationVariables) => data,
  },
  shortcutSettingsSchema,
);

export type setMyShortcutsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type SetMyShortcutsMutationResult = setMyShortcutsResponse;
export type SetMyShortcutsMutationError = Problem;

export const setMyShortcuts = (data: ShortcutSettings, options?: DraftRequest) =>
  draft.fetcher({ data }, options);

export const getSetMyShortcutsMutationKey = () => draft.mutationKey();

export const getSetMyShortcutsMutationOptions = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    setMyShortcutsResponse,
    SetMyShortcutsMutationVariables,
    TError,
    TContext
  >,
) => draft.mutationOptions<TError, TContext>(options);

export const useSetMyShortcuts = <TError = Problem, TContext = unknown>(
  options?: DraftMutationOptions<
    setMyShortcutsResponse,
    SetMyShortcutsMutationVariables,
    TError,
    TContext
  >,
  queryClient?: QueryClient,
) => draft.useDraftMutation<TError, TContext>(options, queryClient);
