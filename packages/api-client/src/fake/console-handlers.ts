import { HttpResponse, http, type RequestHandler } from "msw";
import type {
  Announcement,
  LabSettings,
  MySettingLayers,
  SessionPolicyChange,
  TierChoice,
  TierMapping,
  TierTask,
} from "../generated/api.ts";
import { catalogue, type SettingKey } from "../settings/catalogue.generated.ts";
import { currentAnnouncements, resetAnnouncementBoard } from "./announcement-board.ts";
import { sessionPolicy, tenant } from "./scenario-admin.ts";
import { toAnnouncement } from "./scenario-handlers.ts";
import { modelTiers, tierModels } from "./scenario-viewer-tools.ts";

const seededPolicy = { ...sessionPolicy };

const copyOfTiers = () => modelTiers.map((mapping) => ({ ...mapping }));

let lab: LabSettings = { values: {}, locked: [] };
let tiers: TierMapping[] = copyOfTiers();

export const resetConsoleActions = () => {
  lab = { values: {}, locked: [] };
  tiers = copyOfTiers();
  resetAnnouncementBoard();
  Object.assign(sessionPolicy, seededPolicy);
};

export const liveModelTiers = (): TierMapping[] => tiers.map((mapping) => ({ ...mapping }));

export const liveAnnouncements = (): Announcement[] => currentAnnouncements().map(toAnnouncement);

export const liveWorkspaceSettings = (): LabSettings => ({
  values: { ...lab.values },
  locked: [...lab.locked],
});

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const needs: Record<TierTask, string> = { tumor: "regions", outline: "cells", typer: "cells" };

const isKey = (key: string): key is SettingKey => key in catalogue;

const fits = (key: SettingKey, value: unknown) => {
  const entry = catalogue[key];
  switch (entry.kind) {
    case "choice":
      return typeof value === "string" && (entry.options ?? []).includes(value);
    case "switch":
      return typeof value === "boolean";
    case "id":
      return typeof value === "string" && value !== "";
    case "whole":
      return (
        Number.isInteger(value) &&
        (value as number) >= (entry.minimum ?? Number.NEGATIVE_INFINITY) &&
        (value as number) <= (entry.maximum ?? Number.POSITIVE_INFINITY)
      );
  }
};

export function consoleHandlers(): RequestHandler[] {
  return [
    http.get("*/api/me/setting-layers", () =>
      HttpResponse.json<MySettingLayers>({ lab: liveWorkspaceSettings(), personal: {} }),
    ),
    http.put("*/api/tenant/settings", async ({ request }) => {
      const body = (await request.json()) as { values: Record<string, unknown>; locked?: string[] };
      for (const [key, value] of Object.entries(body.values)) {
        if (!isKey(key) || !catalogue[key].layers.includes("lab")) {
          return problem(
            400,
            "unknown-setting",
            "There is no such setting, or it cannot be set here",
          );
        }
        if (value !== null && !fits(key, value)) {
          return problem(400, "invalid-setting", "A setting's value does not fit it");
        }
      }
      const values = Object.fromEntries(
        Object.entries({ ...lab.values, ...body.values }).filter(([, value]) => value !== null),
      );
      const locked = [...new Set(body.locked ?? [])].sort();
      if (locked.some((key) => !(key in values))) {
        return problem(400, "unknown-setting", "A locked setting needs a workspace value");
      }
      lab = { values, locked };
      return HttpResponse.json(liveWorkspaceSettings());
    }),
    http.put("*/api/tenant/session-policy", async ({ request }) => {
      const change = (await request.json()) as SessionPolicyChange;
      sessionPolicy.idleLockMinutes = change.idle_lock_minutes;
      sessionPolicy.sessionHours = change.session_hours;
      sessionPolicy.emergencyHours = change.emergency_hours ?? sessionPolicy.emergencyHours;
      return HttpResponse.json({
        tenant_id: tenant.id,
        idle_lock_minutes: sessionPolicy.idleLockMinutes,
        session_hours: sessionPolicy.sessionHours,
        emergency_hours: sessionPolicy.emergencyHours,
      });
    }),
    http.put<{ task: TierTask; tier: TierMapping["tier"] }>(
      "*/api/tenant/model-tiers/:task/:tier",
      async ({ request, params }) => {
        const choice = (await request.json()) as TierChoice;
        const known = tierModels.find((item) => item.model.name === choice.name);
        if (known === undefined) {
          return problem(404, "tier-model-not-found", "That model is not listed");
        }
        if (!known.makes.includes(needs[params.task])) {
          return problem(409, "model-wrong-task", "This model does not make what the task needs");
        }
        const mapping: TierMapping = {
          task: params.task,
          tier: params.tier,
          model: known.model,
          set_by_lab: true,
        };
        tiers = tiers.map((item) =>
          item.task === params.task && item.tier === params.tier ? mapping : item,
        );
        return HttpResponse.json(mapping);
      },
    ),
    http.delete<{ task: TierTask; tier: TierMapping["tier"] }>(
      "*/api/tenant/model-tiers/:task/:tier",
      ({ params }) => {
        const original = modelTiers.find(
          (item) => item.task === params.task && item.tier === params.tier,
        );
        if (original === undefined) return problem(404, "not-found", "There is no such tier");
        tiers = tiers.map((item) =>
          item.task === params.task && item.tier === params.tier ? { ...original } : item,
        );
        return HttpResponse.json({ ...original });
      },
    ),
  ];
}
