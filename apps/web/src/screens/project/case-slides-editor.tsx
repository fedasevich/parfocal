import { Trans, useLingui } from "@lingui/react/macro";
import {
  type CaseDetail,
  changeSlideDetails,
  reorderCaseSlides,
  setCaseClinicalNote,
  useGetCase,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { Textarea } from "@parfocal/ui/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import { failureText } from "./new-forms-model.ts";
import {
  blockChoices,
  CLINICAL_NOTE_MAX,
  draftOf,
  moveSlide,
  noteChange,
  orderChanged,
  type SlideDraft,
  slideChange,
  slideErrors,
} from "./slide-edits.ts";

const fieldClass =
  "h-7 w-full min-w-0 rounded-ctl border border-line-strong bg-surf-field px-2 text-body-sm text-fg";

export function CaseSlidesEditor({
  caseId,
  caseLabel,
  clinical,
  onClose,
}: {
  caseId: string;
  caseLabel: string;
  clinical: boolean;
  onClose: () => void;
}) {
  const detail = okData(useGetCase(caseId).data);
  return detail === undefined ? null : (
    <EditorBody detail={detail} caseLabel={caseLabel} clinical={clinical} onClose={onClose} />
  );
}

function EditorBody({
  detail,
  caseLabel,
  clinical,
  onClose,
}: {
  detail: CaseDetail;
  caseLabel: string;
  clinical: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<SlideDraft[]>(() => detail.slides.map(draftOf));
  const [note, setNote] = useState(detail.clinical_note ?? "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const blocks = blockChoices(detail.specimens);
  const blockers = drafts.flatMap((draft) =>
    slideErrors(draft, drafts).map((text, index) => ({
      id: `${draft.id}-${index}`,
      text,
      goTo: "Go to the slide",
    })),
  );
  const edit = (id: string, patch: Partial<SlideDraft>) =>
    setDrafts(drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  const save = async () => {
    setTried(true);
    if (blockers.length > 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      for (const draft of drafts) {
        const before = detail.slides.find((slide) => slide.id === draft.id);
        const change = before ? slideChange(before, draft) : null;
        if (change) await changeSlideDetails(draft.id, change);
      }
      if (orderChanged(detail.slides, drafts))
        await reorderCaseSlides(detail.id, { slide_ids: drafts.map((draft) => draft.id) });
      const changedNote = clinical ? noteChange(detail.clinical_note, note) : null;
      if (changedNote) await setCaseClinicalNote(detail.id, changedNote);
      await queryClient.invalidateQueries();
      onClose();
    } catch (error) {
      setFailure(failureText(error).failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SmallModal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t`Edit slides`}
      subtitle={`Case ${caseLabel}. Labels, stains, blocks, levels and the order of the slides.`}
      width={560}
      hint={failure ?? "Every change is kept in the audit log."}
      primaryLabel="Save slides"
      primaryBusy={busy}
      blockers={tried ? blockers : []}
      blockersTitle="Before you can save"
      onPrimary={() => void save()}
    >
      <ol aria-label={t`Slides in order`} className="grid gap-2">
        {drafts.map((draft, index) => (
          <li
            key={draft.id}
            data-testid="slide-edit-row"
            className="grid grid-cols-[auto_1.3fr_1fr_0.9fr_0.6fr] items-center gap-2"
          >
            <span className="flex gap-0.5">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t`Move ${draft.label} up`}
                disabled={index === 0}
                onClick={() => setDrafts(moveSlide(drafts, draft.id, -1))}
              >
                <Icon name="down" className="rotate-180" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t`Move ${draft.label} down`}
                disabled={index === drafts.length - 1}
                onClick={() => setDrafts(moveSlide(drafts, draft.id, 1))}
              >
                <Icon name="down" />
              </Button>
            </span>
            <Input
              aria-label={t`Label of slide ${index + 1}`}
              value={draft.label}
              maxLength={200}
              className="h-7 text-body-sm"
              onChange={(event) => edit(draft.id, { label: event.target.value })}
            />
            <Input
              aria-label={t`Stain of slide ${index + 1}`}
              value={draft.stain}
              maxLength={60}
              className="h-7 text-body-sm"
              onChange={(event) => edit(draft.id, { stain: event.target.value })}
            />
            <select
              aria-label={t`Block of slide ${index + 1}`}
              value={draft.blockId ?? ""}
              className={fieldClass}
              onChange={(event) => edit(draft.id, { blockId: event.target.value || null })}
            >
              <option value="">
                <Trans>No block</Trans>
              </option>
              {blocks.map((block) => (
                <option key={block.id} value={block.id}>
                  <Trans>Block {block.name}</Trans>
                </option>
              ))}
            </select>
            <Input
              aria-label={t`Level of slide ${index + 1}`}
              value={draft.level}
              inputMode="numeric"
              placeholder={t`Level`}
              className="h-7 text-body-sm"
              onChange={(event) => edit(draft.id, { level: event.target.value })}
            />
          </li>
        ))}
      </ol>
      {clinical ? (
        <div className="mt-3 grid gap-1 text-body-sm text-fg">
          <label htmlFor="case-clinical-note">
            <Trans>Clinical note</Trans>
          </label>
          <Textarea
            id="case-clinical-note"
            value={note}
            maxLength={CLINICAL_NOTE_MAX}
            rows={3}
            placeholder={t`No clinical note`}
            className="text-body-sm"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      ) : null}
    </SmallModal>
  );
}
