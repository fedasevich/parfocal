import type { FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const origin = String(config.projects[0]?.use.baseURL);
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
}
