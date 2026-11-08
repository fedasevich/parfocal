import type { MoreItem } from "@parfocal/ui/components/review-popovers";
import type { ReviewMode } from "@parfocal/ui/components/review-top-bar";
import { destinations } from "../../shell/destinations.ts";

export type TopBarMoreContext = {
  mode: ReviewMode;
  projectId: string;
  slideId: string;
  taskId: string | undefined;
  go: (href: string) => void;
};

export function slidePickerSummary(input: {
  caseLabel: string | null | undefined;
  position: number | undefined;
  total: number | undefined;
  resultSets: number;
}) {
  const parts: string[] = [];
  if (input.caseLabel) parts.push(`Case ${input.caseLabel}`);
  if (input.position !== undefined && input.total !== undefined) {
    parts.push(`${input.position} of ${input.total}`);
  }
  parts.push(`${input.resultSets} ${input.resultSets === 1 ? "result set" : "result sets"}`);
  return parts.join(" · ");
}

export function topBarMoreItems({
  mode,
  projectId,
  slideId,
  taskId,
  go,
}: TopBarMoreContext): MoreItem[] {
  const hasProject = projectId !== "";
  const open = (href: string) => () => {
    if (hasProject) go(href);
  };
  const items: MoreItem[] = [
    { icon: "share", label: "Share this view", title: "Sharing a view is not built yet" },
    { icon: "upload", label: "Add a result set", onSelect: open(destinations.upload(projectId)) },
    { icon: "flask", label: "Run a model", onSelect: open(destinations.runModel(projectId)) },
    {
      icon: "layers",
      label: "Compare with another slide",
      onSelect: open(destinations.compareSlides(projectId, slideId, taskId, "picking")),
    },
    {
      icon: "expand",
      label: "Focus mode",
      keys: "⌘\\",
      onSelect: open(destinations.focus(projectId, slideId, taskId)),
      separatorBefore: true,
    },
    {
      icon: "help",
      label: "Keyboard shortcuts",
      keys: "?",
      onSelect: () => go(destinations.settings("shortcuts")),
    },
    {
      icon: "gear",
      label: "Settings",
      keys: "⌘,",
      onSelect: () => go(destinations.settings("display")),
    },
  ];
  if (mode === "annotate" && taskId) {
    items.splice(1, 0, {
      icon: "comment",
      label: "Ask for a second opinion",
      onSelect: () => go(`/tasks/${taskId}/comments`),
    });
  }
  return items;
}
