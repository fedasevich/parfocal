import { HttpResponse, http, type RequestHandler } from "msw";
import { type MySettings, mySettingsSchema } from "../draft/get-my-settings.ts";
import {
  getEndOtherSessionsMockHandler,
  getListNotificationPreferencesMockHandler,
  getListSessionsMockHandler,
} from "../generated/api.msw.ts";
import type { NotificationKind, Preference, SessionSummary } from "../generated/api.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { sessionPolicy } from "./scenario-admin.ts";
import { mySettings, noticeChannels, sessions } from "./scenario-settings.ts";

let othersEnded = false;

export const resetSettingsActions = () => {
  othersEnded = false;
};

const hoursAfter = (at: string, hours: number) =>
  new Date(new Date(at).getTime() + hours * 3_600_000).toISOString();

export const toSessions = (): SessionSummary[] =>
  sessions
    .filter((session) => session.current || !othersEnded)
    .map((session) => ({
      id: session.id,
      created_at: session.createdAt,
      last_seen_at: session.lastSeenAt,
      active_at: session.lastSeenAt,
      expires_at: hoursAfter(session.createdAt, sessionPolicy.sessionHours),
      user_agent: session.device,
      current: session.current,
      locked: false,
    }));

export const toPreferences = (): Preference[] =>
  noticeChannels.map(({ kind, channel }) => ({
    kind: kind as NotificationKind,
    in_app: channel !== "quiet",
    email: channel === "email",
    realtime: false,
    mandatory: false,
  }));

export const getGetMySettingsMockHandler = (overrideResponse?: MySettings) =>
  http.get("*/api/me/settings", () =>
    HttpResponse.json(mySettingsSchema.parse(overrideResponse ?? mySettings)),
  );

export const settingsDraftOperations: DraftOperation[] = [
  {
    operationId: "getMySettings",
    method: "get",
    path: "/api/me/settings",
    handler: () => getGetMySettingsMockHandler(),
  },
];

export function settingsHandlers(): RequestHandler[] {
  return [
    getListSessionsMockHandler(() => toSessions()),
    getListNotificationPreferencesMockHandler(() => toPreferences()),
    getEndOtherSessionsMockHandler(() => {
      const ended = othersEnded ? 0 : sessions.filter((session) => !session.current).length;
      othersEnded = true;
      return { ended };
    }),
  ];
}
