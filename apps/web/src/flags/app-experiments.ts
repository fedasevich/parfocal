import type { EventSink } from "../telemetry/events.ts";
import { isPseudonymousId } from "./assign.ts";
import { type ArmOf, type FlagKey, flagCatalogue } from "./catalogue.ts";
import {
  bundledFlagDefinitions,
  type Experiments,
  experiments,
  type FlagContext,
  type FlagService,
} from "./flags.ts";

export function defaultArm<Key extends FlagKey>(flagKey: Key): ArmOf<Key> {
  const chosen = bundledFlagDefinitions[flagKey]?.default;
  const arms: readonly string[] = flagCatalogue[flagKey];
  return (chosen !== undefined && arms.includes(chosen) ? chosen : arms[0]) as ArmOf<Key>;
}

export function experimentsLive(config: {
  appEnv: string | undefined;
  fakeApi: string | undefined;
}): boolean {
  return config.appEnv === "prod" && config.fakeApi === "off";
}

export function flagContextFor(me: {
  user_id: string;
  active_tenant_id: string | null;
}): FlagContext | undefined {
  if (!isPseudonymousId(me.user_id)) return undefined;
  const workspace = me.active_tenant_id;
  return workspace !== null && isPseudonymousId(workspace)
    ? { userId: me.user_id, workspaceId: workspace }
    : { userId: me.user_id };
}

export type ExperimentCache = {
  for(context: FlagContext): Experiments;
};

export function experimentCache(service: FlagService, sink: EventSink): ExperimentCache {
  const made = new Map<string, Experiments>();
  return {
    for(context) {
      const key = [context.userId, context.workspaceId ?? "", ...(context.roles ?? [])].join("|");
      let found = made.get(key);
      if (found === undefined) {
        found = experiments(service, context, sink);
        made.set(key, found);
      }
      return found;
    },
  };
}
