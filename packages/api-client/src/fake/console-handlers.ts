import { HttpResponse, http, type RequestHandler } from "msw";
import type {
  Announcement,
  LabSettings,
  MySettingLayers,
  RetentionPolicy,
  SecurityContact,
  SecurityContactChange,
  SessionPolicyChange,
  TierChoice,
  TierMapping,
  TierTask,
} from "../generated/api.ts";
import { catalogue, type SettingKey } from "../settings/catalogue.generated.ts";
import { fitsSetting } from "../settings/resolve.ts";
import { currentAnnouncements, resetAnnouncementBoard } from "./announcement-board.ts";
import { sessionPolicy, tenant } from "./scenario-admin.ts";
import { toAnnouncement } from "./scenario-handlers.ts";
import { taskDisplay } from "./scenario-review.ts";
import { modelTiers, tierModels } from "./scenario-viewer-tools.ts";

const seededPolicy = { ...sessionPolicy };

const copyOfTiers = () => modelTiers.map((mapping) => ({ ...mapping }));

let lab: LabSettings = { values: {}, locked: [] };
const seededPersonal: Record<string, unknown> = {
  home_layout: "both",
  presets: (taskDisplay["RT-14"]?.presets ?? []).map((preset) => preset.name),
};
const personalKey = "parfocal.fake.personal-settings";
const session = (): Storage | null =>
  typeof sessionStorage === "undefined" ? null : sessionStorage;
const storedPersonal = (): Record<string, unknown> | null => {
  const stored = session()?.getItem(personalKey);
  return stored === null || stored === undefined
    ? null
    : (JSON.parse(stored) as Record<string, unknown>);
};
let personal: Record<string, unknown> = storedPersonal() ?? { ...seededPersonal };
const keepPersonal = (values: Record<string, unknown>) => {
  personal = values;
  session()?.setItem(personalKey, JSON.stringify(values));
};
const retentionKey = "parfocal.fake.retention-policy";
const emptyRetention: RetentionPolicy = { deleted_after_days: null, audit_after_days: null };
const storedRetention = (): RetentionPolicy => {
  const stored = session()?.getItem(retentionKey);
  return stored === null || stored === undefined
    ? { ...emptyRetention }
    : (JSON.parse(stored) as RetentionPolicy);
};
const minAuditDays = 365;
const fitsRetention = (policy: RetentionPolicy) =>
  (policy.deleted_after_days ?? 1) >= 1 &&
  (policy.audit_after_days ?? minAuditDays) >= minAuditDays;
let tiers: TierMapping[] = copyOfTiers();
const seededSecurityContact = "security@lab.example";
let securityContact: string | null = seededSecurityContact;

export const resetConsoleActions = () => {
  lab = { values: {}, locked: [] };
  personal = { ...seededPersonal };
  session()?.removeItem(personalKey);
  session()?.removeItem(retentionKey);
  tiers = copyOfTiers();
  securityContact = seededSecurityContact;
  resetAnnouncementBoard();
  Object.assign(sessionPolicy, seededPolicy);
};

export const liveModelTiers = (): TierMapping[] => tiers.map((mapping) => ({ ...mapping }));

export const liveSecurityContact = (): string | null => securityContact;

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

const fits = (key: SettingKey, value: unknown) => fitsSetting(catalogue[key], value);

export function consoleHandlers(): RequestHandler[] {
  return [
    http.get("*/api/me/setting-layers", () =>
      HttpResponse.json<MySettingLayers>({
        lab: liveWorkspaceSettings(),
        personal: { ...personal },
      }),
    ),
    http.put("*/api/me/setting-layers", async ({ request }) => {
      const body = (await request.json()) as { values: Record<string, unknown> };
      for (const [key, value] of Object.entries(body.values)) {
        if (!isKey(key) || !catalogue[key].layers.includes("personal")) {
          return problem(
            400,
            "unknown-setting",
            "There is no such setting, or it cannot be set here",
          );
        }
        if (value !== null && !fits(key, value)) {
          return problem(400, "invalid-setting", "A setting's value does not fit it");
        }
        if (lab.locked.includes(key) && value !== null) {
          return problem(409, "setting-locked", "Your workspace locked this setting");
        }
      }
      keepPersonal(
        Object.fromEntries(
          Object.entries({ ...personal, ...body.values }).filter(([, value]) => value !== null),
        ),
      );
      return HttpResponse.json<MySettingLayers>({
        lab: liveWorkspaceSettings(),
        personal: { ...personal },
      });
    }),
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
    http.get("*/api/tenant/security-contact", () =>
      HttpResponse.json<SecurityContact>({ email: securityContact }),
    ),
    http.put("*/api/tenant/security-contact", async ({ request }) => {
      const change = (await request.json()) as SecurityContactChange;
      const email = change.email?.trim().toLowerCase() ?? null;
      if (email !== null && (email.length > 320 || !emailPattern.test(email))) {
        return problem(422, "invalid-request", "Enter an email address");
      }
      securityContact = email;
      return HttpResponse.json<SecurityContact>({ email });
    }),
    http.get("*/api/tenant/retention", () => HttpResponse.json<RetentionPolicy>(storedRetention())),
    http.put("*/api/tenant/retention", async ({ request }) => {
      const change = (await request.json()) as RetentionPolicy;
      const policy: RetentionPolicy = {
        deleted_after_days: change.deleted_after_days ?? null,
        audit_after_days: change.audit_after_days ?? null,
      };
      if (!fitsRetention(policy)) {
        return problem(422, "invalid-request", "That retention period is too short");
      }
      session()?.setItem(retentionKey, JSON.stringify(policy));
      return HttpResponse.json<RetentionPolicy>(policy);
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
