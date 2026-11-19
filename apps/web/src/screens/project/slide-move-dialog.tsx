import { Trans, useLingui } from "@lingui/react/macro";
import { useListCases } from "@parfocal/api-client";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { Textarea } from "@parfocal/ui/components/textarea";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import { failureText } from "./new-forms-model.ts";
import { type SlideToast, useSlideMove } from "./slide-move-action.ts";
import {
  caseIdOfTarget,
  looseTarget,
  moveErrors,
  moveTitle,
  targetChoices,
} from "./slide-move-model.ts";

const fieldClass =
  "h-7 w-full min-w-0 rounded-ctl border border-line-strong bg-surf-field px-2 text-body-sm text-fg";

export function SlideMoveDialog({
  projectId,
  slideId,
  slideTitle,
  caseLabel,
  toast,
  onClose,
}: {
  projectId: string;
  slideId: string;
  slideTitle: string;
  caseLabel: string | null;
  toast: SlideToast;
  onClose: () => void;
}) {
  const { t } = useLingui();

  const move = useSlideMove(toast);
  const cases = okData(useListCases({ project_id: projectId }).data) ?? [];
  const choices = targetChoices(cases, caseLabel);
  const caseIdOf = (label: string | null) => cases.find((item) => item.label === label)?.id ?? null;
  const [caseId, setCaseId] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const blockers = moveErrors(caseId, reason).map((text, index) => ({
    id: `move-${index}`,
    text,
    goTo: t`Go to the field`,
  }));
  const save = async () => {
    setTried(true);
    if (blockers.length > 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const target = caseIdOfTarget(caseId);
      await move(
        { id: slideId, title: slideTitle, fromCaseId: caseIdOf(caseLabel), fromLabel: caseLabel },
        { caseId: target, label: choices.find((item) => item.id === target)?.label ?? null },
        reason.trim(),
      );
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
      title={moveTitle(caseLabel !== null)}
      subtitle={
        caseLabel === null
          ? t`${slideTitle} has no case yet.`
          : t`${slideTitle} sits in case ${caseLabel}.`
      }
      hint={
        failure ? (
          <span role="alert" className="text-bad">
            {failure}
          </span>
        ) : (
          t`The move and the reason are kept in the audit log.`
        )
      }
      primaryLabel={caseLabel === null ? t`File slide` : t`Move slide`}
      primaryBusy={busy}
      blockers={tried ? blockers : []}
      blockersTitle={t`Before you can move it`}
      onPrimary={() => void save()}
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-body-sm text-fg-dim">
          <Trans>Case</Trans>
          <select
            value={caseId}
            className={fieldClass}
            onChange={(event) => setCaseId(event.target.value)}
          >
            <option value="">
              <Trans>Pick a case</Trans>
            </option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
            {caseLabel === null ? null : (
              <option value={looseTarget}>{t`Loose slides, no case`}</option>
            )}
          </select>
        </label>
        <div className="grid gap-1 text-body-sm text-fg-dim">
          <label htmlFor="slide-move-reason">
            <Trans>Reason</Trans>
          </label>
          <Textarea
            id="slide-move-reason"
            value={reason}
            maxLength={500}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
    </SmallModal>
  );
}
