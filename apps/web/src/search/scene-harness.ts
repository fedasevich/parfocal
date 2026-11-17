import { z } from "zod";

type HarnessEnv = { PARFOCAL_PUBLIC_FAKE_API?: string | undefined } | undefined;

function buildEnv(): HarnessEnv {
  try {
    return { PARFOCAL_PUBLIC_FAKE_API: import.meta.env.PARFOCAL_PUBLIC_FAKE_API };
  } catch {
    return undefined;
  }
}

export function sceneHarnessOn(env: HarnessEnv = buildEnv()): boolean {
  if (env === undefined) return true;
  return (env.PARFOCAL_PUBLIC_FAKE_API || "off") !== "off";
}

export function sceneField<const Values extends readonly [string, ...string[]]>(
  values: Values,
  live: readonly Values[number][] = [],
  harness: boolean = sceneHarnessOn(),
) {
  return z
    .enum(values)
    .optional()
    .transform((value) =>
      value === undefined || harness || live.includes(value) ? value : undefined,
    );
}
