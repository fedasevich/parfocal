import { isPseudonymousId } from "./assign.ts";
import type { FlagContext, FlagDefinitions, RemoteArms } from "./targeting.ts";

export type PostHogFlagConfig = {
  host: string;
  projectKey: string;
  fetch: typeof fetch;
};

type RemoteFlag = { enabled?: unknown; variant?: unknown };

export function postHogFlagRequest(projectKey: string, context: FlagContext) {
  if (!isPseudonymousId(context.userId)) throw new Error("flags need a pseudonymous user id");
  return {
    api_key: projectKey,
    distinct_id: context.userId,
    groups: context.workspaceId === undefined ? {} : { workspace: context.workspaceId },
    person_properties: { roles: [...(context.roles ?? [])].sort().join(",") },
    group_properties: {},
  };
}

export function remoteArmsFrom(body: unknown, definitions: FlagDefinitions): RemoteArms {
  const flags = (body as { flags?: Record<string, RemoteFlag> } | null)?.flags;
  if (flags === undefined || flags === null || typeof flags !== "object") return {};
  const arms: Record<string, string | false> = {};
  for (const [key, definition] of Object.entries(definitions)) {
    const flag = flags[key];
    if (flag === undefined || flag === null) continue;
    if (flag.enabled === false) arms[key] = false;
    else if (typeof flag.variant === "string" && definition.arms.includes(flag.variant)) {
      arms[key] = flag.variant;
    }
  }
  return arms;
}

export async function fetchPostHogArms(
  config: PostHogFlagConfig,
  context: FlagContext,
  definitions: FlagDefinitions,
): Promise<RemoteArms> {
  const body = JSON.stringify(postHogFlagRequest(config.projectKey, context));
  try {
    const response = await config.fetch(`${config.host.replace(/\/$/u, "")}/flags/?v=2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) return {};
    return remoteArmsFrom(await response.json(), definitions);
  } catch {
    return {};
  }
}
