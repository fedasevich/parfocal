import { z } from "zod";

type HarnessEnv =
  | {
      PARFOCAL_PUBLIC_DEV_TOOLS?: string | undefined;
      PARFOCAL_PUBLIC_FAKE_API?: string | undefined;
    }
  | undefined;

function buildEnv(): HarnessEnv {
  try {
    return {
      PARFOCAL_PUBLIC_DEV_TOOLS: import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS,
      PARFOCAL_PUBLIC_FAKE_API: import.meta.env.PARFOCAL_PUBLIC_FAKE_API,
    };
  } catch {
    return undefined;
  }
}

export function sceneHarnessOn(env: HarnessEnv = buildEnv()): boolean {
  if (env === undefined) return true;
  return (
    env.PARFOCAL_PUBLIC_DEV_TOOLS === "on" && (env.PARFOCAL_PUBLIC_FAKE_API || "off") !== "off"
  );
}

export type SceneFieldMeta = { scenes: readonly string[]; live: readonly string[] };

export function sceneField<const Values extends readonly [string, ...string[]]>(
  values: Values,
  live: readonly Values[number][] = [],
  harness: boolean = sceneHarnessOn(),
) {
  const meta: SceneFieldMeta = { scenes: values, live };
  return z
    .enum(values)
    .optional()
    .transform((value) =>
      value === undefined || harness || live.includes(value) ? value : undefined,
    )
    .meta(meta);
}
