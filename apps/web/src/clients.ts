import type { WebConfig } from "./config.ts";

export type ErrorReporter = { capture(error: unknown): void };
export type Analytics = { capture(event: string, properties: Record<string, string>): void };
export type FlagClient = { variant(flag: string): string | undefined };

export type WebClients = {
  errors: ErrorReporter;
  analytics: Analytics;
  flags: FlagClient;
};

export type ProductionFactories = {
  [Concern in keyof WebClients]?: (config: WebConfig) => WebClients[Concern];
};

const consoleErrors: ErrorReporter = {
  capture(error) {
    console.error(error);
  },
};

const noAnalytics: Analytics = { capture() {} };

export function fileFlags(defaults: Record<string, string>): FlagClient {
  return { variant: (flag) => defaults[flag] };
}

function production<Concern extends keyof WebClients>(
  concern: Concern,
  factories: ProductionFactories,
  config: WebConfig,
): WebClients[Concern] {
  const factory = factories[concern];
  if (factory === undefined) throw new Error(`no production ${concern} client is configured`);
  return factory(config);
}

export function selectWebClients(
  config: WebConfig,
  factories: ProductionFactories,
  flagDefaults: Record<string, string> = {},
): WebClients {
  if (config.appEnv !== "prod") {
    return { errors: consoleErrors, analytics: noAnalytics, flags: fileFlags(flagDefaults) };
  }
  return {
    errors: production("errors", factories, config),
    analytics: production("analytics", factories, config),
    flags: production("flags", factories, config),
  };
}
