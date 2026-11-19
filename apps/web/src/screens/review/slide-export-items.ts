import { t } from "@lingui/core/macro";
import type { MoreItem } from "@parfocal/ui/components/review-popovers";
import { downloadSlideExport, slideExportChoices } from "../../annotations/slide-export.ts";

export function slideExportItems(slideId: string, taskId: string | undefined): MoreItem[] {
  return slideExportChoices().map((choice, index) => ({
    icon: "download",
    label: t`Export ${choice.label}`,
    note: choice.line,
    onSelect: () => void downloadSlideExport(slideId, choice.format, taskId),
    separatorBefore: index === 0,
  }));
}
