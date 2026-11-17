import type { FullConfig } from "@playwright/test";
import { counts, purgeRun } from "./tests/workspaces.ts";

export default async function globalSetup(config: FullConfig): Promise<() => void> {
  const origin = String(config.projects[0]?.use.baseURL);
  const health = await fetch(`${origin}/api/health`).catch(() => undefined);
  if (!health?.ok) {
    throw new Error("The API container does not answer. Run pnpm stack:up first.");
  }
  const login = await fetch(`${origin}/api/auth/login?return_to=/`, { redirect: "manual" });
  const target = new URL(login.headers.get("location") ?? "", origin);
  if (target.hostname !== "localhost") {
    throw new Error(`The API sends sign-in to ${target.host}, not to the local Zitadel`);
  }
  const available: unknown = await (await fetch(`${origin}/api/auth/password-sign-in`)).json();
  if (
    !(typeof available === "object" && available !== null && Reflect.get(available, "available"))
  ) {
    throw new Error("The API has no Zitadel login client, so the app's own sign-in is off");
  }
  const before = counts();
  return () => {
    purgeRun();
    const after = counts();
    if (after.workspaces > before.workspaces || after.organisations > before.organisations) {
      throw new Error(
        `The run left data behind: ${JSON.stringify(before)} before and ${JSON.stringify(after)} after`,
      );
    }
  };
}
