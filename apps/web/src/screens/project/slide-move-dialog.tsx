import { moveSlide, useListCases } from "@parfocal/api-client";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { Textarea } from "@parfocal/ui/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { okData } from "../placeholder.tsx";
import { failureText } from "./new-forms-model.ts";
import { moveErrors, moveTitle, targetChoices } from "./slide-move-model.ts";

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
  toast: (message: ReactNode) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const cases = okData(useListCases({ project_id: projectId }).data) ?? [];
  const choices = targetChoices(cases, caseLabel);
  const [caseId, setCaseId] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const blockers = moveErrors(caseId, reason).map((text, index) => ({
    id: `move-${index}`,
    text,
    goTo: "Go to the field",
  }));
  const save = async () => {
    setTried(true);
    if (blockers.length > 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await moveSlide(slideId, { case_id: caseId, reason: reason.trim() });
      await queryClient.invalidateQueries();
      toast(`${slideTitle} is now in case ${choices.find((item) => item.id === caseId)?.label}`);
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
          ? `${slideTitle} has no case yet.`
          : `${slideTitle} sits in case ${caseLabel}.`
      }
      hint={
        failure ? (
          <span role="alert" className="text-bad">
            {failure}
          </span>
        ) : (
          "The move and the reason are kept in the audit log."
        )
      }
      primaryLabel={caseLabel === null ? "File slide" : "Move slide"}
      primaryBusy={busy}
      blockers={tried ? blockers : []}
      blockersTitle="Before you can move it"
      onPrimary={() => void save()}
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-body-sm text-fg-dim">
          Case
          <select
            value={caseId}
            className={fieldClass}
            onChange={(event) => setCaseId(event.target.value)}
          >
            <option value="">Pick a case</option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1 text-body-sm text-fg-dim">
          <label htmlFor="slide-move-reason">Reason</label>
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
