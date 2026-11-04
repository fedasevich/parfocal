import { HttpResponse, http, type RequestHandler } from "msw";
import {
  type MySettings,
  mySettingsSchema,
  type ShortcutSettings,
  shortcutSettingsSchema,
} from "../draft/get-my-settings.ts";
import {
  getEndOtherSessionsMockHandler,
  getGetMyAvailabilityMockHandler,
  getListNotificationPreferencesMockHandler,
  getListSessionsMockHandler,
} from "../generated/api.msw.ts";
import type {
  AvailabilityChange,
  MemberAvailability,
  NotificationKind,
  Preference,
  SessionSummary,
} from "../generated/api.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { people } from "./scenario.ts";
import { sessionPolicy } from "./scenario-admin.ts";
import { mySettings, noticeChannels, sessions } from "./scenario-settings.ts";
import { fakeView } from "./view.ts";

let othersEnded = false;
let myAvailability: AvailabilityChange = { status: "available" };
let savedShortcuts: ShortcutSettings | null = null;

export const resetSettingsActions = () => {
  othersEnded = false;
  savedShortcuts = null;
  myAvailability = { status: "available" };
};

export const toMyAvailability = (): MemberAvailability => ({
  user_id: people[fakeView().viewer].id,
  status: myAvailability.status,
  until: myAvailability.status === "away" ? (myAvailability.until ?? null) : null,
  note: myAvailability.status === "away" ? (myAvailability.note ?? null) : null,
});

const allowedAvailability = (change: AvailabilityChange) =>
  !(change.status === "available" && (change.until || change.note)) &&
  !(change.until && new Date(change.until).getTime() <= Date.now());

const invalidAvailability = () =>
  HttpResponse.json(
    {
      type: "about:blank",
      title: "Only away takes an end or a note, and the end must be ahead",
      status: 400,
      code: "invalid-availability",
    },
    { status: 400, headers: { "content-type": "application/problem+json" } },
  );

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
    HttpResponse.json(
      mySettingsSchema.parse(
        overrideResponse ??
          (savedShortcuts === null ? mySettings : { ...mySettings, shortcuts: savedShortcuts }),
      ),
    ),
  );

export const getSetMyShortcutsMockHandler = (overrideResponse?: ShortcutSettings) =>
  http.put("*/api/me/shortcuts", async ({ request }) => {
    if (overrideResponse) return HttpResponse.json(overrideResponse);
    const parsed = shortcutSettingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        { type: "about:blank", title: "The shortcuts are not valid", status: 422 },
        { status: 422, headers: { "content-type": "application/problem+json" } },
      );
    }
    savedShortcuts = parsed.data;
    return HttpResponse.json(parsed.data);
  });

export const settingsDraftOperations: DraftOperation[] = [
  {
    operationId: "getMySettings",
    method: "get",
    path: "/api/me/settings",
    handler: () => getGetMySettingsMockHandler(),
  },
  {
    operationId: "setMyShortcuts",
    method: "put",
    path: "/api/me/shortcuts",
    handler: () => getSetMyShortcutsMockHandler(),
  },
];

export function settingsHandlers(): RequestHandler[] {
  return [
    getListSessionsMockHandler(() => toSessions()),
    getListNotificationPreferencesMockHandler(() => toPreferences()),
    getGetMyAvailabilityMockHandler(() => toMyAvailability()),
    http.put("*/api/me/availability", async ({ request }) => {
      const change = (await request.json()) as AvailabilityChange;
      if (!allowedAvailability(change)) return invalidAvailability();
      myAvailability = change;
      return HttpResponse.json(toMyAvailability());
    }),
    getEndOtherSessionsMockHandler(() => {
      const ended = othersEnded ? 0 : sessions.filter((session) => !session.current).length;
      othersEnded = true;
      return { ended };
    }),
  ];
}
