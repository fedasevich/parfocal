import { linkOptions } from "@tanstack/react-router";
import { onboardingScenes } from "./scenes.ts";

const signInNotes = {
  email: "Email and password, with the deep link to RT-14",
  magic: "Sign-in link sent, with a 6-digit code",
  sso: "Institution single sign-on",
  forgot: "Forgot password",
  reset: "New password checked for length, reuse and leaks",
  passkey: "Passkey, the browser asks",
  passkeyqr: "Passkey on a phone or key",
  lock: "Locked after inactivity",
  lockkey: "Unlock with a passkey",
  expired: "Issue · session expired",
  noaccess: "Issue · no access, Anna asks for Lymph nodes 2026",
} as const;

const setupNotes = {
  role: "1 · You, role and specialty",
  workspace: "2 · Workspace, join or create one",
  project: "3 · First project, sample or your own",
  device: "4 · Viewer, input device and theme",
  done: "5 · Done, getting started",
} as const;

const adminNotes = {
  overview: "Fakultní nemocnice Vltava at a glance",
  people: "People and roles, Daniel with admin rights",
  projects: "Every project with its privacy and space",
  models: "Parfocal's models and the lab's own",
  templates: "Study templates with their report blocks",
  storage: "Space used, rules and sources",
  api: "Tokens and webhooks for pipelines",
  audit: "Who did what today",
  security: "Sign-in, sessions and where data is kept",
  tplnew: "The New study template modal",
  tpledit: "The report template editor on CAMELYON rounds",
} as const;

export const onboardingPrototypeLinks = [
  ...onboardingScenes.signin.map((scene) => ({
    key: `signin-${scene}`,
    label: `Sign in · ${scene}`,
    note: signInNotes[scene],
    link: linkOptions({ to: "/sign-in", search: { scene } }),
  })),
  ...onboardingScenes.signup.map((scene) => ({
    key: `signup-${scene}`,
    label: `Sign up · ${scene}`,
    note: scene === "form" ? "Create an account" : "Confirm the email with a code",
    link: linkOptions({ to: "/sign-up", search: { scene } }),
  })),
  ...onboardingScenes.invite.map((scene) => ({
    key: `invite-${scene}`,
    label: `Invite · ${scene}`,
    note: scene === "landing" ? "Daniel invites Simona to RT-14" : "Join in one step",
    link: linkOptions({ to: "/invite", search: { scene } }),
  })),
  ...onboardingScenes.setup.map((step) => ({
    key: `setup-${step}`,
    label: `Setup · ${step}`,
    note: setupNotes[step],
    link: linkOptions({ to: "/setup", search: { step } }),
  })),
  ...(Object.keys(adminNotes) as (keyof typeof adminNotes)[]).map((scene) => ({
    key: `admin-${scene}`,
    label: `Admin · ${scene}`,
    note: adminNotes[scene],
    link: linkOptions({ to: "/admin", search: { scene } }),
  })),
];
