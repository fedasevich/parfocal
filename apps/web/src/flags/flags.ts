import type { Analytics } from "../clients.ts";
import { type EventSink, eventSink } from "../telemetry/events.ts";
import type { ArmOf, FlagKey } from "./catalogue.ts";
import flagDefaults from "./flag-defaults.json" with { type: "json" };
import {
  evaluateFlag,
  type FlagContext,
  type FlagDefinitions,
  type FlagEvaluation,
  type RemoteArms,
} from "./targeting.ts";

export type {
  FlagContext,
  FlagDefinition,
  FlagDefinitions,
  FlagEvaluation,
  FlagRule,
  RemoteArms,
} from "./targeting.ts";

export type FlagService = {
  evaluate(flagKey: string, context: FlagContext): FlagEvaluation;
};

export const bundledFlagDefinitions = flagDefaults as FlagDefinitions;

export function localFlagService(
  definitions: FlagDefinitions = bundledFlagDefinitions,
): FlagService {
  return { evaluate: (flagKey, context) => evaluateFlag(definitions, flagKey, context) };
}

export function remoteFlagService(
  remote: RemoteArms,
  definitions: FlagDefinitions = bundledFlagDefinitions,
): FlagService {
  return { evaluate: (flagKey, context) => evaluateFlag(definitions, flagKey, context, remote) };
}

export type IdentifiedAnalytics = {
  send(distinctId: string, event: string, properties: Record<string, unknown>): void;
};

export function identifiedAnalytics(userId: string, target: IdentifiedAnalytics): Analytics {
  return { capture: (event, properties) => target.send(userId, event, properties) };
}

export type Experiments = {
  arm<Key extends FlagKey>(flagKey: Key): ArmOf<Key>;
};

const assigned = new Set(["split", "remote"]);

export function experiments(
  service: FlagService,
  context: FlagContext,
  sink: EventSink,
): Experiments {
  const exposed = new Set<string>();
  return {
    arm<Key extends FlagKey>(flagKey: Key) {
      const { arm, reason } = service.evaluate(flagKey, context);
      if (assigned.has(reason) && !exposed.has(flagKey)) {
        exposed.add(flagKey);
        sink.track("experiment_exposed", { flag: flagKey, arm });
      }
      return arm as ArmOf<Key>;
    },
  };
}

export function experimentsFor(
  service: FlagService,
  context: FlagContext,
  target: IdentifiedAnalytics,
  optedOut: () => boolean,
): Experiments {
  return experiments(
    service,
    context,
    eventSink(identifiedAnalytics(context.userId, target), optedOut),
  );
}
