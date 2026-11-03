export const onboardingScenes = {
  signin: [
    "email",
    "magic",
    "sso",
    "forgot",
    "reset",
    "passkey",
    "passkeyqr",
    "lock",
    "lockkey",
    "expired",
    "noaccess",
  ],
  signup: ["form", "verify"],
  invite: ["landing", "account"],
  setup: ["role", "workspace", "project", "device", "done"],
  admin: [
    "overview",
    "people",
    "projects",
    "models",
    "templates",
    "storage",
    "api",
    "audit",
    "security",
    "settings",
    "tplnew",
    "tpledit",
    "addmodel",
    "addtested",
    "addfail",
    "addmap",
  ],
} as const;

export type SignInScene = (typeof onboardingScenes.signin)[number];
export type SignUpScene = (typeof onboardingScenes.signup)[number];
export type InviteScene = (typeof onboardingScenes.invite)[number];
export type SetupStep = (typeof onboardingScenes.setup)[number];
export type AdminScene = (typeof onboardingScenes.admin)[number];

export const adminSections = [
  "overview",
  "people",
  "projects",
  "models",
  "templates",
  "storage",
  "api",
  "audit",
  "security",
  "settings",
] as const;

export type AdminSection = (typeof adminSections)[number];

export const adminModals = ["invite", "contract"] as const;

export type AdminModal = (typeof adminModals)[number];

export const connectModelScenes = ["addmodel", "addtested", "addfail", "addmap"] as const;

export type ConnectModelScene = (typeof connectModelScenes)[number];

export const isConnectModelScene = (scene: AdminScene | undefined): scene is ConnectModelScene =>
  connectModelScenes.some((key) => key === scene);

const isAdminSection = (scene: AdminScene | undefined): scene is AdminSection =>
  adminSections.some((key) => key === scene);

export function sectionOf(
  section: AdminSection | undefined,
  scene: AdminScene | undefined,
): AdminSection {
  if (scene === "tplnew" || scene === "tpledit") return "templates";
  if (isConnectModelScene(scene)) return "models";
  if (isAdminSection(scene)) return scene;
  return section ?? "overview";
}
