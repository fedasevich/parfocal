import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const NoticeChannel = { email: "email", bell: "bell", quiet: "quiet" } as const;

export const ShortcutPreset = {
  default: "default",
  qupath: "qupath",
  figma: "figma",
} as const;

export const WholeSlideKey = { both: "both", hold: "hold", tap: "tap" } as const;

export const mySettingsSchema = z.object({
  personal: z.object({
    density: z.enum(["comfortable", "compact"]),
    lengths: z.enum(["auto", "um"]),
    language: z.enum(["en", "cs"]),
    presets: z.array(z.string()),
    default_preset: z.string(),
    signature_block: z.boolean(),
    tools: z.enum(["left", "bottom"]),
    side_panel_width: z.union([z.literal(300), z.literal(340), z.literal(420)]),
    hide_side_panel: z.boolean(),
    panel_while_moving: z.enum(["pinned", "auto"]),
    minimap: z.enum(["useful", "always", "never"]),
    pinned_slide_strip: z.boolean(),
    model_warnings: z.boolean(),
    double_click: z.enum(["zoom", "toggle"]),
    initials_while_sharing: z.boolean(),
    slide_submitted_notice: z.enum(NoticeChannel),
  }),
  shortcuts: z.object({
    preset: z.enum(ShortcutPreset),
    custom: z.record(z.string(), z.array(z.string())),
    single_letter: z.boolean(),
    by_position: z.boolean(),
    whole_slide_key: z.enum(WholeSlideKey),
  }),
});

export type MySettings = z.infer<typeof mySettingsSchema>;

export const getGetMySettingsUrl = () => "/api/me/settings";

const draft = defineDraftQuery("getMySettings", getGetMySettingsUrl, mySettingsSchema);

export type getMySettingsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetMySettingsQueryResult = getMySettingsResponse;
export type GetMySettingsQueryError = Problem;

export const getMySettings = (options?: DraftRequest) => draft.fetcher([], options);

export const getGetMySettingsQueryKey = () => draft.queryKey();

export const getGetMySettingsQueryOptions = <TData = getMySettingsResponse, TError = Problem>(
  options?: DraftQueryOptions<getMySettingsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useGetMySettings = <TData = getMySettingsResponse, TError = Problem>(
  options?: DraftQueryOptions<getMySettingsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
