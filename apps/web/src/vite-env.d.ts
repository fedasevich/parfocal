interface ImportMetaEnv {
  readonly PARFOCAL_PUBLIC_APP_ENV?: string;
  readonly PARFOCAL_PUBLIC_API_BASE_URL?: string;
  readonly PARFOCAL_PUBLIC_FAKE_API?: string;
  readonly PARFOCAL_PUBLIC_MODELS_URL?: string;
}

declare module "*.po" {
  export const messages: import("@lingui/core").Messages;
}
