import { HttpResponse, http, type RequestHandler } from "msw";
import type { Maintenance, MaintenanceStart, PlatformStatus } from "../generated/api.ts";

const storageKey = "parfocal-fake-maintenance";

let kept: Maintenance | null = null;

const stored = (): Storage | undefined =>
  typeof sessionStorage === "undefined" ? undefined : sessionStorage;

function currentMaintenance(): Maintenance | null {
  const saved = stored()?.getItem(storageKey);
  return saved == null ? kept : (JSON.parse(saved) as Maintenance);
}

export function setFakeMaintenance(next: Maintenance | null): void {
  kept = next;
  if (next === null) stored()?.removeItem(storageKey);
  else stored()?.setItem(storageKey, JSON.stringify(next));
}

const statusNow = (): PlatformStatus => {
  const maintenance = currentMaintenance();
  return maintenance === null
    ? { status: "ok", maintenance: null }
    : { status: "maintenance", maintenance };
};

export function statusHandlers(): RequestHandler[] {
  return [
    http.get("*/api/status", () => HttpResponse.json(statusNow())),
    http.put("*/api/platform/maintenance", async ({ request }) => {
      const start = (await request.json()) as MaintenanceStart;
      setFakeMaintenance({
        message: start.message,
        started_at: currentMaintenance()?.started_at ?? new Date().toISOString(),
        expected_end_at: start.expected_end_at ?? null,
      });
      return HttpResponse.json(statusNow());
    }),
    http.delete("*/api/platform/maintenance", () => {
      setFakeMaintenance(null);
      return HttpResponse.json(statusNow());
    }),
  ];
}
