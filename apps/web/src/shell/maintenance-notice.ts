import { ApiError, type PlatformStatus } from "@parfocal/api-client";

export const maintenanceCheckMs = 30_000;

export type MaintenanceNotice = { message: string; expectedEndAt: Date | null };

export function maintenanceNotice(status: PlatformStatus | undefined): MaintenanceNotice | null {
  const current = status?.maintenance;
  if (status?.status !== "maintenance" || current == null) return null;
  return {
    message: current.message,
    expectedEndAt: current.expected_end_at == null ? null : new Date(current.expected_end_at),
  };
}

export function isMaintenanceError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503 && error.problem?.code === "maintenance";
}
