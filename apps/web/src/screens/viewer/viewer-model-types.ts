import type { AnalysisTemplate, ViewerPart } from "@parfocal/api-client";
import type { CameraSearch } from "../review/camera-search.ts";
import type { ReviewSession } from "../review/review-data.ts";
import type { StayTool } from "../review/review-rail.ts";
import type { ViewerScene, ViewerTab } from "./viewer-scenes.ts";

export type ViewerSearch = CameraSearch & {
  task?: string | undefined;
  object?: string | undefined;
  scene?: ViewerScene | undefined;
  tab?: ViewerTab | undefined;
  modal?: "preset" | undefined;
  tool?: StayTool | undefined;
  across?: string | undefined;
  peek?: boolean | undefined;
  focus?: boolean | undefined;
  layout?: "compare" | "focus" | undefined;
};

export type FullViewerProps = {
  projectId: string;
  slideId: string;
  search: ViewerSearch;
  onSearch: (change: Partial<ViewerSearch>) => void;
  panelOnly?: boolean;
};

export type BodyProps = FullViewerProps & {
  session: ReviewSession;
  clinical: boolean;
  projectCode: string;
  projectName: string;
  viewerParts: ViewerPart[];
  template: AnalysisTemplate;
};

export function addedSize(note: string | null) {
  return note?.match(/(\d+(?:\.\d+)?) mm/)?.[0] ?? "";
}
