export const appEnvs = ["dev", "test", "preview", "staging", "prod"] as const;
export type AppEnv = (typeof appEnvs)[number];

export const fakeApiModes = ["off", "all", "drafts"] as const;
export type FakeApiMode = (typeof fakeApiModes)[number];

const realDataEnvs: readonly AppEnv[] = ["staging", "prod"];

export type PublicEnv = {
  PARFOCAL_PUBLIC_APP_ENV?: string | undefined;
  PARFOCAL_PUBLIC_API_BASE_URL?: string | undefined;
  PARFOCAL_PUBLIC_FAKE_API?: string | undefined;
};

export type WebConfig = {
  appEnv: AppEnv;
  apiBaseUrl: string;
  fakeApi: FakeApiMode;
};

function isAppEnv(value: string | undefined): value is AppEnv {
  return appEnvs.some((appEnv) => appEnv === value);
}

function isFakeApiMode(value: string): value is FakeApiMode {
  return fakeApiModes.some((mode) => mode === value);
}

export function readFakeApiMode(value: string | undefined, appEnv: AppEnv): FakeApiMode {
  const mode = value || "off";
  if (!isFakeApiMode(mode)) {
    throw new Error(
      `PARFOCAL_PUBLIC_FAKE_API must be one of ${fakeApiModes.join(", ")}, got ${mode}`,
    );
  }
  if (mode !== "off" && realDataEnvs.includes(appEnv)) {
    throw new Error(`PARFOCAL_PUBLIC_FAKE_API must be off in ${appEnv}, got ${mode}`);
  }
  return mode;
}

export function readConfig(env: PublicEnv): WebConfig {
  const appEnv = env.PARFOCAL_PUBLIC_APP_ENV;
  if (!isAppEnv(appEnv)) {
    throw new Error(
      `PARFOCAL_PUBLIC_APP_ENV must be one of ${appEnvs.join(", ")}, got ${appEnv ?? "nothing"}`,
    );
  }
  return {
    appEnv,
    apiBaseUrl: env.PARFOCAL_PUBLIC_API_BASE_URL || "/api",
    fakeApi: readFakeApiMode(env.PARFOCAL_PUBLIC_FAKE_API, appEnv),
  };
}

export function readBuildConfig(): WebConfig {
  return readConfig({
    PARFOCAL_PUBLIC_APP_ENV: import.meta.env.PARFOCAL_PUBLIC_APP_ENV,
    PARFOCAL_PUBLIC_API_BASE_URL: import.meta.env.PARFOCAL_PUBLIC_API_BASE_URL,
    PARFOCAL_PUBLIC_FAKE_API: import.meta.env.PARFOCAL_PUBLIC_FAKE_API,
  });
}
