import type { Analytics } from "../clients.ts";
import { type EventSink, eventSink } from "../telemetry/events.ts";
import { assignArm, isPseudonymousId } from "./assign.ts";
import flagDefaults from "./flag-defaults.json" with { type: "json" };

export type FlagDefinition = {
  arms: readonly string[];
  default: string;
  mode: "default" | "split";
};

export type FlagDefinitions = Record<string, FlagDefinition>;

export type FlagService = {
  arm(flagKey: string, userId: string): string;
};

export const bundledFlagDefinitions: FlagDefinitions = flagDefaults as FlagDefinitions;

export function localFlagService(
  definitions: FlagDefinitions = bundledFlagDefinitions,
): FlagService {
  return {
    arm(flagKey, userId) {
      const definition = definitions[flagKey];
      if (definition === undefined) throw new Error(`unknown flag ${flagKey}`);
      if (!isPseudonymousId(userId)) throw new Error("flags need a pseudonymous user id");
      return definition.mode === "split"
        ? assignArm(flagKey, userId, definition.arms)
        : definition.default;
    },
  };
}

export type IdentifiedAnalytics = {
  send(distinctId: string, event: string, properties: Record<string, unknown>): void;
};

export function identifiedAnalytics(userId: string, target: IdentifiedAnalytics): Analytics {
  return { capture: (event, properties) => target.send(userId, event, properties) };
}

export type Experiments = {
  arm(flagKey: string): string;
};

export function experiments(
  service: FlagService,
  userId: string,
  sink: EventSink,
  definitions: FlagDefinitions = bundledFlagDefinitions,
): Experiments {
  const exposed = new Set<string>();
  return {
    arm(flagKey) {
      const arm = service.arm(flagKey, userId);
      if (definitions[flagKey]?.mode === "split" && !exposed.has(flagKey)) {
        exposed.add(flagKey);
        sink.track("experiment_exposed", { flag: flagKey, arm });
      }
      return arm;
    },
  };
}

export function experimentsFor(
  service: FlagService,
  userId: string,
  target: IdentifiedAnalytics,
  optedOut: () => boolean,
  definitions: FlagDefinitions = bundledFlagDefinitions,
): Experiments {
  return experiments(
    service,
    userId,
    eventSink(identifiedAnalytics(userId, target), optedOut),
    definitions,
  );
}
