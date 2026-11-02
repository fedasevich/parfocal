import {
  getGetMyAdjudicationQueryKey,
  useDecideAdjudication,
  useGetMe,
  useGetMyAdjudication,
  useGetReviewTask,
  useGetTaskDisplay,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { KeyValueList } from "@parfocal/ui/components/connect-model";
import { DecisionButtons } from "@parfocal/ui/components/decision-buttons";
import {
  EvidenceList,
  EvidenceRow,
  ProgressDots,
  QuotedNote,
} from "@parfocal/ui/components/disagreements";
import { Icon } from "@parfocal/ui/components/icon";
import { SlidesPopover } from "@parfocal/ui/components/review-popovers";
import { ReviewTopBar } from "@parfocal/ui/components/review-top-bar";
import { SidePanel } from "@parfocal/ui/components/side-panel";
import { ObjectIdTag, StatusTag } from "@parfocal/ui/components/tag";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountMenu } from "../../shell/account-menu.tsx";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { useRouterLink } from "../../shell/router-link.tsx";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { DisplayTab } from "../review/display-tab.tsx";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import { lookUrl } from "../thumbnails.ts";
import {
  type Answer,
  adjudicatorWhy,
  answerText,
  answerTone,
  answerWord,
  stillOf,
} from "./text.ts";

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

const dueText = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "";

export function AdjudicatorView({ taskId }: { taskId: string }) {
  const adjudication = okData(useGetMyAdjudication(taskId).data);
  const task = okData(useGetReviewTask(taskId).data);
  const display = okData(useGetTaskDisplay(taskId).data);
  const me = okData(useGetMe().data);
  const person = usePeople();
  const renderLink = useRouterLink();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [tab, setTab] = useState("review");
  const [camera, setCamera] = useState<Camera | null>(null);
  const decideMutation = useDecideAdjudication({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMyAdjudicationQueryKey(taskId) }),
    },
  });
  const objects = adjudication?.objects ?? [];
  const decided = objects.filter((object) => object.decision !== null);
  const counts = {
    agree: decided.filter((object) => object.decision === "agree").length,
    disagree: decided.filter((object) => object.decision === "disagree").length,
    unsure: decided.filter((object) => object.decision === "unsure").length,
    open: objects.length - decided.length,
  };
  const allDone = objects.length > 0 && counts.open === 0;
  const current = objects[Math.max(0, Math.min(objects.length - 1, index))];
  const asker = person(adjudication?.asked_by_user_id)?.name.split(" ")[0] ?? "The researcher";
  const goTo = (next: number) => {
    setIndex(((next % objects.length) + objects.length) % objects.length);
    setCamera(null);
  };
  const decide = (raw: Answer) => {
    if (!current) return;
    decideMutation.mutate({
      taskId,
      slideId: current.slide_id,
      object: current.object,
      data: { raw },
    });
    const at = objects.indexOf(current);
    const next = [...objects.slice(at + 1), ...objects.slice(0, at)].find(
      (object) => object.decision === null,
    );
    if (next) goTo(objects.indexOf(next));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey || allDone) return;
      const raw = ({ k: "agree", x: "disagree", u: "unsure" } as const)[
        event.key.toLowerCase() as "k" | "x" | "u"
      ];
      if (raw) {
        event.preventDefault();
        decide(raw);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const shown = allDone ? objects[objects.length - 1] : current;
  const percent = objects.length ? Math.round((100 * decided.length) / objects.length) : 0;
  const review = allDone ? (
    <div className="grid content-start gap-4 p-1">
      <Icon name="check" size="lg" className="text-ok" />
      <h2 className="m-0 text-title font-semibold text-fg">
        All {objects.length} decided. {asker} is told.
      </h2>
      <p className="m-0 text-body-sm text-fg-dim">
        Your decisions sit next to the reviewers' answers and never replace them.
      </p>
      <KeyValueList
        tight
        rows={objects.map((object) => ({
          icon: object.kind === "cell" ? "target" : "flag",
          label: object.object,
          value: object.decision ? (
            <StatusTag tone={answerTone[object.decision]}>{answerWord[object.decision]}</StatusTag>
          ) : (
            ""
          ),
        }))}
      />
      <Button
        className="justify-self-start"
        onClick={() => void navigate({ to: "/my-work", search: { scene: "anna" } })}
      >
        Back to My work
      </Button>
    </div>
  ) : current ? (
    <div className="grid content-start gap-4">
      <div className="flex items-center justify-between">
        <span className="text-body-sm text-fg-dim">{asker} asked you to decide</span>
        <ObjectIdTag size="lg">{current.object}</ObjectIdTag>
      </div>
      <ProgressDots
        current={objects.indexOf(current)}
        onJump={goTo}
        summary={`${decided.length} of ${objects.length} decided`}
        items={objects.map((object) => ({
          key: object.key,
          label: object.object,
          value: object.decision,
        }))}
      />
      <div className="grid gap-1">
        <small className="text-body-sm font-semibold text-fg">
          {adjudicatorWhy(current.reviewer_a, current.reviewer_b)}
        </small>
        <h2 className="m-0 text-title font-semibold text-fg">
          The AI says {current.object} is {current.ai.class_name.toLowerCase()},{" "}
          {Math.round(current.ai.score * 100)}% sure.
        </h2>
        <p className="m-0 text-body-sm text-fg-dim">
          {current.kind === "cell"
            ? "Cell in the sample"
            : `${current.size_mm?.toFixed(2).replace(/0$/, "")} mm across`}
        </p>
      </div>
      <EvidenceList>
        {(
          [
            ["A", current.reviewer_a],
            ["B", current.reviewer_b],
          ] as const
        ).map(([letter, answer]) => (
          <EvidenceRow key={letter} icon="user" title={`Reviewer ${letter}`}>
            <StatusTag tone={answerTone[answer.raw]}>{answerText(answer)}</StatusTag>
            {answer.note ? <QuotedNote>{answer.note}</QuotedNote> : null}
          </EvidenceRow>
        ))}
      </EvidenceList>
      <DecisionButtons
        decisionStyle="agree"
        label={`Your decision on ${current.object}`}
        value={current.decision ?? undefined}
        onValueChange={(raw) => decide(raw as Answer)}
      />
      <p className="m-0 text-center text-body-sm text-fg-dim">
        Reviewers stay anonymous to you, so the decision is about the tissue.
      </p>
    </div>
  ) : (
    <p className="m-0 text-body-sm text-fg-dim">Nothing is queued for you on this task.</p>
  );
  const foot =
    allDone || !current ? undefined : (
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          disabled={objects.indexOf(current) === 0}
          title={objects.indexOf(current) === 0 ? "This is the first object" : undefined}
          onClick={() => goTo(objects.indexOf(current) - 1)}
        >
          <Icon name="back" />
          Previous
        </Button>
        <Button variant="ghost" onClick={() => goTo(objects.indexOf(current) + 1)}>
          {current.decision ? "Next" : "Skip for now"}
          <Icon name="next" />
        </Button>
      </div>
    );
  const slideLabels = [...new Set(objects.map((object) => object.slide_label))];
  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-page">
      <ReviewTopBar
        mode="adjudicate"
        taskName={`Adjudication · ${task?.code ?? ""}`}
        taskSub={`Sentinel node AI evaluation · due ${dueText(task?.due_on)}`}
        slideName={`${shown?.slide_label ?? "A1"} · H&E`}
        slideThumb={lookUrl("overview")}
        progress={counts}
        slidesPopover={
          <SlidesPopover
            ariaLabel="Slides with objects queued for you"
            caseHeading="Slides with objects for you"
            showKeys={false}
            caseSlides={slideLabels.map((label) => {
              const count = objects.filter((object) => object.slide_label === label).length;
              const open = label === (shown?.slide_label ?? slideLabels[0]);
              return {
                id: label,
                name: `${label} · H&E`,
                sub: `${count} object${count === 1 ? "" : "s"} · ${decided.length} decided`,
                thumb: lookUrl("overview"),
                resultSets: count,
                current: open,
                status: open
                  ? { label: "Open", tone: "accent" as const }
                  : { label: "Queued", tone: "neutral" as const },
              };
            })}
            onPick={(label) => {
              const target = objects.findIndex((object) => object.slide_label === label);
              if (target >= 0) goTo(target);
            }}
          />
        }
        progressTitle={`${decided.length} of ${objects.length} decided`}
        progressSub="Objects queued for you"
        primaryTitle={`${percent}% decided`}
        onPrimary={() => void navigate({ to: "/my-work", search: { scene: "anna" } })}
        backHref={destinations.myWork()}
        renderLink={renderLink}
        accountSlot={<AccountMenu me={me} person={personOf(me)} />}
      />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_470px]">
        <div className="relative flex min-h-0 overflow-hidden bg-canvas">
          {shown ? (
            <SlideStill
              view={allDone ? { kind: "cell", object: "T1·C145" } : stillOf(shown)}
              camera={camera}
              onCameraChange={setCamera}
              regionDecisions={{}}
              claimHidden={false}
              showIds
              slideName={shown.slide_label}
            />
          ) : null}
        </div>
        <SidePanel
          width={470}
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "review", label: "Review", body: review, ...(foot ? { foot } : {}) },
            {
              value: "display",
              label: "Display",
              body: <DisplayTab display={display} preset={null} extraLocks={[]} />,
            },
          ]}
        />
      </div>
    </div>
  );
}
