import {
  ApiError,
  getGetReviewTaskQueryKey,
  getGetTaskEvaluationQueryKey,
  getListReviewTasksQueryKey,
  type ReviewTask,
  useChangeReviewTask,
  useGetReviewTask,
  useGetReviewTaskStates,
  useGetTaskEvaluation,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { CountsAsLine } from "@parfocal/ui/components/counts-as";
import { DrawerPanel } from "@parfocal/ui/components/drawer-panel";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { countsAsRule } from "@parfocal/ui/lib/counts-as-rule";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { styleName } from "../evaluation/numbers.ts";
import { okData } from "../placeholder.tsx";
import { decisionSettings, toReviewStyle } from "../review/decision-mapping.ts";
import { type Range, recountOf, recountText, sameRange, splitOf } from "./task-settings-model.ts";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 text-body-sm">
      <span className="text-fg-dim">{label}</span>
      <span className="text-fg">{children}</span>
    </div>
  );
}

export function TaskSettingsDrawer({
  task,
  onClose,
  toast,
}: {
  task: ReviewTask;
  onClose: () => void;
  toast: (message: ReactNode) => void;
}) {
  const queryClient = useQueryClient();
  const detail = okData(useGetReviewTask(task.id).data) ?? task;
  const signedOff = okData(useGetReviewTaskStates(task.id).data)?.signed_off_at != null;
  const evaluation = okData(useGetTaskEvaluation(task.id).data);
  const change = useChangeReviewTask();
  const stored = toReviewStyle(detail.decision);
  const storedRange: Range = { agreeFrom: stored.agreeFrom, disagreeTo: stored.disagreeTo };
  const [picked, setPicked] = useState<Range | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const range = picked ?? storedRange;
  const editable = stored.kind === "certainty" && !signedOff;
  const dirty = !sameRange(range, storedRange);
  const answers = evaluation?.decisions.answers ?? {};
  const recount = recountOf(answers, storedRange, range);

  const save = () => {
    setFailure(null);
    change.mutate(
      {
        taskId: task.id,
        data: { decision: decisionSettings(stored.kind, range, stored.question) },
      },
      {
        onSuccess: () => {
          setConfirming(false);
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetReviewTaskQueryKey(task.id) }),
            queryClient.invalidateQueries({ queryKey: getGetTaskEvaluationQueryKey(task.id) }),
            queryClient.invalidateQueries({
              queryKey: getListReviewTasksQueryKey(task.project_id),
            }),
          ]);
          toast(
            <>
              Counts as changed on {task.code}. {recountText(recount)}{" "}
              <Link
                to="/tasks/$taskId/evaluation"
                params={{ taskId: task.id }}
                className="font-semibold text-accent underline"
              >
                See the Methods block
              </Link>
            </>,
          );
          onClose();
        },
        onError: (error) =>
          setFailure(
            error instanceof ApiError && error.kind === "conflict"
              ? "Counts as cannot change after sign-off."
              : "The change was not saved. Check the mapping and try again.",
          ),
      },
    );
  };

  return (
    <DrawerPanel
      scrim
      label={`Settings for ${task.code}`}
      title="Task settings"
      hint={<span className="font-mono">{task.code}</span>}
      width={560}
      testId="task-settings"
      onClose={onClose}
      footer={
        <>
          <Hint>
            {editable
              ? "Reviewers' raw answers never change."
              : signedOff
                ? "Counts as is locked at sign-off."
                : "Counts as is fixed by the style."}
          </Hint>
          <span className="flex-1" />
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            disabled={!editable || !dirty}
            onClick={() => setConfirming(true)}
          >
            Save Counts as
          </Button>
        </>
      }
    >
      <Zone title={task.name} sub="Pinned when the task was sent.">
        <Fact label="Decision style">{styleName[stored.kind]}</Fact>
        {stored.question ? <Fact label="Question">{stored.question}</Fact> : null}
        <Hint>The style cannot change once a decision exists.</Hint>
      </Zone>
      <Zone
        title="Counts as"
        sub="How each answer counts toward agree, not sure and disagree in the evaluation."
      >
        <CountsAsLine
          decisionStyle={stored.kind}
          agreeFrom={range.agreeFrom}
          disagreeTo={range.disagreeTo}
          split={splitOf(answers, range)}
          {...(editable ? { onRangeChange: setPicked } : {})}
        />
        {signedOff ? <Hint>This task is signed off, so the mapping is locked.</Hint> : null}
        {!signedOff && !editable ? (
          <Hint>This style counts each answer by its own rule, so there is nothing to map.</Hint>
        ) : null}
      </Zone>
      <SmallModal
        open={confirming}
        onOpenChange={(next) => {
          if (!next) {
            setConfirming(false);
            setFailure(null);
          }
        }}
        title={`Change Counts as on ${task.code}?`}
        subtitle={countsAsRule(stored.kind, range)}
        width={480}
        hint={failure ?? "Written to the audit log and the task's log with your name."}
        primaryLabel="Change Counts as"
        primaryBusy={change.isPending}
        onPrimary={save}
      >
        <p data-testid="recount" className="m-0 text-body font-semibold text-fg">
          {recountText(recount)}
        </p>
        <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">
          Every stored decision is counted again from the raw answers. The report's Methods block
          says that Counts as changed, who changed it and when.
        </p>
      </SmallModal>
    </DrawerPanel>
  );
}
