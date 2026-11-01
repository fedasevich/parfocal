export type MyWorkTab = "review" | "assigned" | "all";

export type MyWorkScene = "review" | "preview" | "anna" | "assigned" | "all" | "allpreview";

export type MyWorkState = {
  tab: MyWorkTab;
  sel: string | undefined;
  q: string;
  scene: MyWorkScene | undefined;
};

const sceneTabs: Record<MyWorkScene, MyWorkTab> = {
  review: "review",
  preview: "review",
  anna: "review",
  assigned: "assigned",
  all: "all",
  allpreview: "all",
};

export const tabOf = (tab: MyWorkTab | undefined, scene: MyWorkScene | undefined): MyWorkTab =>
  tab ?? (scene ? sceneTabs[scene] : "review");
