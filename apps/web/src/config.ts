export const appEnvs = ["dev", "test", "preview", "staging", "prod"] as const;
export type AppEnv = (typeof appEnvs)[number];

export type PublicEnv = {
  PARFOCAL_PUBLIC_APP_ENV?: string | undefined;
  PARFOCAL_PUBLIC_API_BASE_URL?: string | undefined;
};

export type WebConfig = {
  appEnv: AppEnv;
  apiBaseUrl: string;
};

function isAppEnv(value: string | undefined): value is AppEnv {
  return appEnvs.some((appEnv) => appEnv === value);
}

export function readConfig(env: PublicEnv): WebConfig {
  const appEnv = env.PARFOCAL_PUBLIC_APP_ENV;
  if (!isAppEnv(appEnv)) {
    throw new Error(
      `PARFOCAL_PUBLIC_APP_ENV must be one of ${appEnvs.join(", ")}, got ${appEnv ?? "nothing"}`,
    );
  }
  return { appEnv, apiBaseUrl: env.PARFOCAL_PUBLIC_API_BASE_URL || "/api" };
}

export function readBuildConfig(): WebConfig {
  return readConfig({
    PARFOCAL_PUBLIC_APP_ENV: import.meta.env.PARFOCAL_PUBLIC_APP_ENV,
    PARFOCAL_PUBLIC_API_BASE_URL: import.meta.env.PARFOCAL_PUBLIC_API_BASE_URL,
  });
}
