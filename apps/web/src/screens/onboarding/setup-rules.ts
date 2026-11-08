import type { SettingValues } from "@parfocal/api-client";
import { destinations } from "../../shell/destinations.ts";
import { homeLayoutOfSetup, type SetupRole } from "../home/home-layout.ts";

export type SetupFirst = "sample" | "create" | "wait";
export type SetupDevice = "mouse" | "trackpad" | "spacemouse" | "gamepad" | "pen" | "keyboard";
export type SetupMode = "deid" | "clin";

export type WorkspaceMove =
  | { kind: "none" }
  | { kind: "join"; workspaceId: string }
  | { kind: "ask"; workspaceId: string }
  | { kind: "create"; name: string; privacy: SettingValues["default_privacy_mode"] };

export const recommendedFirst = (role: SetupRole): SetupFirst =>
  role === "res" ? "create" : "sample";

export const shortcutPresetOf = (viewer: string): SettingValues["shortcut_preset"] =>
  viewer === "QuPath" ? "qupath" : "default";

export const wheelModeOf = (device: SetupDevice): SettingValues["wheel_mode"] =>
  device === "trackpad" ? "pan" : "zoom";

export const personalValuesOf = (choice: {
  role: SetupRole;
  viewer: string;
}): Pick<SettingValues, "home_layout" | "shortcut_preset"> => ({
  home_layout: homeLayoutOfSetup[choice.role],
  shortcut_preset: shortcutPresetOf(choice.viewer),
});

export const workspaceMoveOf = (choice: {
  picked: string;
  matchedId: string | undefined;
  askedId: string | undefined;
  name: string;
  mode: SetupMode;
}): WorkspaceMove => {
  if (choice.picked === "new") {
    const name = choice.name.trim();
    if (name === "") return { kind: "none" };
    return {
      kind: "create",
      name,
      privacy: choice.mode === "clin" ? "clinical" : "de-identified",
    };
  }
  if (choice.picked !== "" && choice.picked === choice.askedId) {
    return { kind: "ask", workspaceId: choice.picked };
  }
  if (choice.picked !== "" && choice.picked === choice.matchedId) {
    return { kind: "join", workspaceId: choice.picked };
  }
  return { kind: "none" };
};

export const firstDestination = (first: SetupFirst, sampleProjectId?: string): string => {
  if (first === "sample" && sampleProjectId !== undefined) {
    return destinations.project(sampleProjectId);
  }
  if (first === "create") return destinations.newProject();
  return destinations.home();
};

export const creatorNote = "Creating a workspace gives you admin rights on it as a researcher.";
