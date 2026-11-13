import type { WebConfig } from "./config.ts";
import { consentedAnalytics } from "./telemetry/consent.ts";
import { SensitiveValues, scrubError, scrubFields } from "./telemetry/scrubbing.ts";

export type ErrorReporter = { capture(error: unknown): void };
export type Analytics = { capture(event: string, properties: Record<string, unknown>): void };
export type FlagClient = { variant(flag: string): string | undefined };

export type WebClients = {
  errors: ErrorReporter;
  analytics: Analytics;
  flags: FlagClient;
  sensitive: SensitiveValues;
};

type ProductionClients = Omit<WebClients, "sensitive">;

export type ProductionFactories = {
  [Concern in keyof ProductionClients]?: (config: WebConfig) => ProductionClients[Concern];
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

export function scrubbedErrors(reporter: ErrorReporter, sensitive: SensitiveValues): ErrorReporter {
  return { capture: (error) => reporter.capture(scrubError(error, sensitive)) };
}

export function scrubbedAnalytics(analytics: Analytics, sensitive: SensitiveValues): Analytics {
  return {
    capture: (event, properties) =>
      analytics.capture(sensitive.redact(event), scrubFields(properties, sensitive)),
  };
}

export function selectWebClients(
  config: WebConfig,
  factories: ProductionFactories,
  flagDefaults: Record<string, string> = {},
  sensitive: SensitiveValues = new SensitiveValues(),
): WebClients {
  const switchedOn = config.appEnv === "prod" ? factories : {};
  const errors = switchedOn.errors?.(config) ?? consoleErrors;
  const analytics = switchedOn.analytics?.(config) ?? noAnalytics;
  return {
    errors: scrubbedErrors(errors, sensitive),
    analytics: consentedAnalytics(scrubbedAnalytics(analytics, sensitive)),
    flags: switchedOn.flags?.(config) ?? fileFlags(flagDefaults),
    sensitive,
  };
}
