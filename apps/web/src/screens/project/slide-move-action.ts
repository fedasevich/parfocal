import { useLingui } from "@lingui/react/macro";
import { moveSlide } from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { failureText } from "./new-forms-model.ts";
import { type MovedSlide, undoReason } from "./slide-move-model.ts";

export type SlideToast = (message: ReactNode, onUndo?: () => void) => void;

export type MoveTarget = { caseId: string | null; label: string | null };

export function useSlideMove(toast: SlideToast) {
  const { t } = useLingui();
  const queryClient = useQueryClient();

  const landed = (title: string, label: string | null) =>
    label === null ? t`${title} is now a loose slide` : t`${title} is now in case ${label}`;

  const send = async (slideId: string, caseId: string | null, reason: string) => {
    await moveSlide(slideId, { case_id: caseId, reason });
    await queryClient.invalidateQueries();
  };

  const undo = (slide: MovedSlide) => {
    void send(slide.id, slide.fromCaseId, undoReason(slide.fromLabel))
      .then(() => toast(landed(slide.title, slide.fromLabel)))
      .catch((error: unknown) => toast(failureText(error).failure ?? t`The move was not undone`));
  };

  return async (slide: MovedSlide, target: MoveTarget, reason: string) => {
    await send(slide.id, target.caseId, reason);
    toast(landed(slide.title, target.label), () => undo(slide));
  };
}
