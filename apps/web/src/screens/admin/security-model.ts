import type { LabSettings, SecuritySetting, WorkspaceSettingsChange } from "@parfocal/api-client";

export const TWO_FACTOR_KEY = "two_factor_required";
export const IDLE_LOCK_KEY = "idle-lock";

const ssoNotSetUp: SecuritySetting = {
  key: "sso",
  label: "Single sign-on",
  detail: "Connects through your identity provider and is not set up for this workspace yet",
  on: false,
  locked: true,
};

export function twoFactorRequired(lab: LabSettings | undefined): boolean {
  return lab?.values[TWO_FACTOR_KEY] === true;
}

export function twoFactorRow(lab: LabSettings): SecuritySetting {
  return {
    key: TWO_FACTOR_KEY,
    label: "Two factors for everyone",
    detail:
      "Saved for the workspace. Sign-in will ask every member for a second factor once that ships",
    on: twoFactorRequired(lab),
    locked: false,
  };
}

export function signInRows(
  listed: SecuritySetting[] | undefined,
  lab: LabSettings | undefined,
): SecuritySetting[] {
  const sso = listed?.find((item) => item.key === "sso");
  const rest = (listed ?? []).filter((item) => item.key !== "sso" && item.key !== TWO_FACTOR_KEY);
  return [
    sso ? { ...sso, locked: true } : ssoNotSetUp,
    ...rest,
    ...(lab ? [twoFactorRow(lab)] : []),
  ];
}

export function twoFactorChange(lab: LabSettings, on: boolean): WorkspaceSettingsChange {
  return { values: { [TWO_FACTOR_KEY]: on }, locked: lab.locked };
}
