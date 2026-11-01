import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const invitePreviewSchema = z.object({
  token: z.string(),
  email: z.string(),
  name: z.string(),
  invited_by: z.object({
    user_id: z.string(),
    display_name: z.string(),
    initials: z.string(),
    avatar_colour: z.number().int().nonnegative(),
    title: z.string().nullable(),
  }),
  sent_at: z.iso.datetime({ offset: true }),
  workspace: z.object({ id: z.string(), name: z.string() }),
  project: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    colour: z.number().int().nonnegative(),
    privacy_mode: z.enum(["de-identified", "clinical"]),
    study_template: z.string(),
  }),
  task: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    slides: z.number().int().nonnegative(),
    hours: z.number().nonnegative(),
    scope: z.string(),
    due_on: z.iso.date(),
    blinded: z.boolean(),
    first_slide_id: z.string(),
  }),
  specialty: z.string().nullable(),
  expires_on: z.iso.date(),
});

export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const getGetInvitePreviewUrl = (token: string) => `/api/invitations/${token}/preview`;

const draft = defineDraftQuery("getInvitePreview", getGetInvitePreviewUrl, invitePreviewSchema);

export type getInvitePreviewResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type GetInvitePreviewQueryResult = getInvitePreviewResponse;
export type GetInvitePreviewQueryError = Problem;

export const getInvitePreview = (token: string, options?: DraftRequest) =>
  draft.fetcher([token], options);

export const getGetInvitePreviewQueryKey = (token: string) => draft.queryKey(token);

export const getGetInvitePreviewQueryOptions = <TData = getInvitePreviewResponse, TError = Problem>(
  token: string,
  options?: DraftQueryOptions<getInvitePreviewResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([token], options);

export const useGetInvitePreview = <TData = getInvitePreviewResponse, TError = Problem>(
  token: string,
  options?: DraftQueryOptions<getInvitePreviewResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([token], options, queryClient);
