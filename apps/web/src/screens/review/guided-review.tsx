import { useSaveVerdict, useSubmitSlideReview } from "@parfocal/api-client";
import { Banner, InlineState } from "@parfocal/ui/components/banner";
import type { Blocker } from "@parfocal/ui/components/before-you-list";
import { Button } from "@parfocal/ui/components/button";
import { CellCluster, CellsLauncher } from "@parfocal/ui/components/cells-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SidePanel } from "@parfocal/ui/components/side-panel";
import { type OpinionQuestion, SlideDoneCard } from "@parfocal/ui/components/slide-done-card";
import { UndoToast } from "@parfocal/ui/components/undo-toast";
import { cn } from "@parfocal/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { usePeople } from "../people.ts";
import { CellsGrid } from "./cells-grid.tsx";
import { useSetName } from "./cells-on-slide.tsx";
import {
  answersOf,
  type Confidence,
  cardText,
  countsAs,
  countWord,
  rawFor,
  rawLabel,
  showsClaim,
} from "./decision-style.ts";
import { type DisplayLock, DisplayTab, displaySettings } from "./display-tab.tsx";
import {
  finishingAnswers,
  type GuidedScene,
  type GuidedTab,
  guidedSetup,
} from "./guided-scenes.ts";
import {
  answerLabel,
  type LockLine,
  NoteEditor,
  noteReasonsFor,
  ObjectCard,
  ObjectDots,
  SavedNote,
} from "./object-card.tsx";
import { ObjectComments, ThreadList, useThreadMessages } from "./object-comments.tsx";
import { type ReviewSession, useReviewSession } from "./review-data.ts";
import { type Answer, type Answers, answerOf, baseAnswers, countAnswers } from "./review-state.ts";
import { ReviewTop } from "./review-top.tsx";
import { type Camera, readout, SlideStill, type StillView } from "./slide-still.tsx";

type GuidedReviewProps = {
  taskId: string;
  slideId: string;
  scene: GuidedScene | undefined;
  submitted: boolean;
  tab: GuidedTab | undefined;
  onTabChange: (tab: GuidedTab) => void;
};

export function GuidedReview(props: GuidedReviewProps) {
  const session = useReviewSession(props.taskId, props.slideId);
  if (!session.ready) {
    return (
      <main className="grid h-dvh place-items-center bg-page text-fg-dim">Loading the review…</main>
    );
  }
  return (
    <GuidedBody key={`${props.scene ?? "region"}-${props.slideId}`} session={session} {...props} />
  );
}

type BodyProps = GuidedReviewProps & { session: ReviewSession };

const netOff = "The connection is lost. It saves when the connection is back.";

function GuidedBody({ session, scene, submitted, tab, onTabChange }: BodyProps) {
  const setup = guidedSetup(scene);
  const navigate = useNavigate();
  const person = usePeople();
  const saveVerdict = useSaveVerdict();
  const submitReview = useSubmitSlideReview();
  const style = setup.style ? { ...session.style, kind: setup.style } : session.style;
  const objects = setup.issue === "noresults" ? [] : session.objects;
  const noResults = objects.length === 0;
  const regions = objects.filter((item) => item.kind === "region");
  const cells = objects.filter((item) => item.kind === "cell");
  const base = baseAnswers(objects, session.verdicts, style, setup.stage, finishingAnswers);
  const [overrides, setOverrides] = useState<Answers>(
    () =>
      new Map(
        Object.entries(setup.answered).map(([object, value]) => [
          object,
          {
            value,
            raw: rawFor(
              style,
              value,
              objects.find((item) => item.object === object),
            ),
            reasons: [],
            note: null,
          },
        ]),
      ),
  );
  const answer = (object: string) => answerOf(base, overrides, object);
  const firstOpenCell = () => {
    const at = objects.findIndex((item) => item.kind === "cell" && !answer(item.object));
    return at < 0 ? regions.length : at;
  };
  const [index, setIndex] = useState(() => {
    if (setup.focus === "first-open-cell") return firstOpenCell();
    return Math.max(
      0,
      objects.findIndex((item) => item.object === setup.focus),
    );
  });
  const [showDone, setShowDone] = useState(setup.done);
  const [disagreeOpen, setDisagreeOpen] = useState(setup.disagreeOpen);
  const [noteFor, setNoteFor] = useState<string | null>(setup.noteDraft ? "current" : null);
  const [noteDraft, setNoteDraft] = useState(setup.noteDraft ?? { reasons: [], text: "" });
  const [cellsShut, setCellsShut] = useState(false);
  const [cellsFolded, setCellsFolded] = useState(false);
  const [confirmRest, setConfirmRest] = useState(setup.cellsPreview);
  const [whole, setWhole] = useState(setup.whole || setup.done);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [opinion, setOpinion] = useState<Record<string, string>>(() => {
    const answers = Object.fromEntries(
      Object.entries(session.opinion?.answers ?? {}).map(([key, value]) => [key, String(value)]),
    );
    for (const key of setup.dropAnswers) delete answers[key];
    return answers;
  });
  const [failed, setFailed] = useState(setup.submitFail);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  const tabNow: GuidedTab = setup.coach ? "review" : (tab ?? setup.tab);
  const current = objects[Math.min(index, Math.max(0, objects.length - 1))];
  const currentId = current?.object ?? "";
  const counts = countAnswers(objects, answer);
  const settings = displaySettings(
    session.display,
    setup.preset,
    setup.confidenceLock
      ? [{ setting: "confidence", value: "hidden", reason: setup.confidenceLock }]
      : [],
  );
  const confidence = settings.confidence as Confidence;
  const extraLocks: DisplayLock[] = setup.confidenceLock
    ? [{ setting: "confidence", value: "hidden", reason: setup.confidenceLock }]
    : [];
  const readOnly = setup.readOnly || setup.issue === "withdrawn";
  const tileFail = setup.issue === "slidefail";
  const lockLine: LockLine = setup.readOnly
    ? { icon: "lock", text: "Signed off. Ask the researcher to amend.", tone: "lock" }
    : tileFail
      ? {
          icon: "warn",
          text: `${session.slideName.split(" ")[0]} can't be read at 20x and 40x yet. Retry, or ask the researcher.`,
          tone: "warn",
        }
      : null;
  const buttonsOff = readOnly || tileFail || setup.connLost;
  const blindReviewers = (session.task?.slides[0]?.reviewer_ids ?? []).filter(
    (id) => id !== session.meId,
  );
  const otherReviewer = person(blindReviewers[0])?.name.split(" ")[0] ?? "the other reviewer";
  const threadOf = (object: string) => session.threads.find((item) => item.anchor === object);
  const messages = useThreadMessages(threadOf(currentId), session.meId);
  const setName = useSetName(session);

  const goTo = (at: number) => {
    setIndex(Math.max(0, Math.min(objects.length - 1, at)));
    setDisagreeOpen(false);
    setNoteFor(null);
    setCamera(null);
    setWhole(false);
    setShowDone(false);
  };
  const jump = (target: string) => {
    if (target === "cells") {
      setCellsShut(false);
      goTo(firstOpenCell());
      return;
    }
    goTo(objects.findIndex((item) => item.object === target));
  };
  const advance = (from: number, decided: Answers) => {
    const at = (object: string) => answerOf(base, decided, object);
    const next = objects.findIndex((item, position) => position > from && !at(item.object));
    const wrap = objects.findIndex((item) => !at(item.object));
    const target = next >= 0 ? next : wrap;
    if (target < 0) {
      setShowDone(true);
      setWhole(true);
      return;
    }
    goTo(target);
  };
  const put = (object: string, value: Answer | null) => {
    const next = new Map(overrides);
    next.set(object, value);
    setOverrides(next);
    return next;
  };
  const answerWith = (raw: string) => {
    if (current === undefined || buttonsOff) return;
    const value = countsAs(style, raw, current);
    const previous = overrides.get(currentId);
    const kept = answer(currentId);
    const next = put(currentId, {
      value,
      raw,
      reasons: kept?.value === value ? kept.reasons : [],
      note: kept?.note ?? null,
    });
    saveVerdict.mutate({
      taskId: session.taskId,
      slideId: session.slideId,
      objectId: currentId,
      data: { value },
    });
    const label = rawLabel(style, raw, session.classes);
    setToast({
      id: Date.now(),
      text:
        style.kind === "agree"
          ? `${currentId}: ${countWord[value].toLowerCase()}`
          : `${currentId}: ${label}, counts as ${countWord[value].toLowerCase()}`,
      undo: () => {
        const restore = new Map(next);
        if (previous === undefined) restore.delete(currentId);
        else restore.set(currentId, previous);
        setOverrides(restore);
        setIndex(index);
        setShowDone(false);
      },
    });
    if (style.kind === "agree" && value === "disagree") {
      setDisagreeOpen(true);
      return;
    }
    if (settings.auto) advance(index, next);
  };
  const toggleReason = (reason: string) => {
    const kept = answer(currentId);
    if (!kept) return;
    const reasons = kept.reasons.includes(reason)
      ? kept.reasons.filter((item) => item !== reason)
      : [...kept.reasons, reason];
    put(currentId, { ...kept, reasons });
  };
  const saveNote = () => {
    const kept = answer(currentId);
    if (kept) {
      put(currentId, {
        ...kept,
        reasons: noteDraft.reasons.length ? noteDraft.reasons : kept.reasons,
        note: noteDraft.text.trim() || null,
      });
    }
    setNoteFor(null);
  };
  const openNote = () => {
    const kept = answer(currentId);
    setNoteDraft({ reasons: kept?.reasons ?? [], text: kept?.note ?? "" });
    setNoteFor("current");
  };
  const toSubmitted = () =>
    navigate({
      to: "/tasks/$taskId/submitted",
      params: { taskId: session.taskId },
      search: { slide: session.slideId },
    });
  const submit = () => {
    if (failed) {
      setFailed(false);
      return;
    }
    submitReview.mutate({ taskId: session.taskId, slideId: session.slideId });
    void toSubmitted();
  };

  useEffect(() => {
    const keys = new Map(
      answersOf(style, session.classes, current).map((item) => [item.key.toLowerCase(), item.raw]),
    );
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], [role=dialog]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (showDone || noResults) return;
      const raw = keys.get(event.key.toLowerCase());
      if (raw && !event.shiftKey) {
        event.preventDefault();
        answerWith(raw);
      } else if (event.key === "n" || event.key === "N") {
        if (answer(currentId)) {
          event.preventDefault();
          openNote();
        }
      } else if (event.key === "ArrowRight") {
        goTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        goTo(index - 1);
      } else if (event.key === "Escape") {
        if (confirmRest) setConfirmRest(false);
        else if (current?.kind === "cell") setCellsShut(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const regionDecisions = Object.fromEntries(
    regions.map((region) => [region.object, answer(region.object)?.value]),
  );
  const cellDecisions = Object.fromEntries(
    cells.map((cell) => [cell.object, answer(cell.object)?.value]),
  );
  const openCells = cells.filter((cell) => !answer(cell.object));
  const view: StillView =
    whole || showDone || noResults
      ? { kind: "whole" }
      : current?.kind === "cell"
        ? { kind: "cell", object: currentId }
        : { kind: "region", object: currentId };
  const submitReason =
    counts.open > 0
      ? `${counts.open} object${counts.open === 1 ? " is" : "s are"} still open.`
      : undefined;
  const openRegions = regions.filter((region) => !answer(region.object));
  const blockers: Blocker[] = [
    ...openRegions.map((region) => ({
      id: region.object,
      text: `${region.object} is still open`,
      goTo: `Go to ${region.object}`,
      onGoTo: () => jump(region.object),
    })),
    ...(openCells.length
      ? [
          {
            id: "cells",
            text: `${openCells.length} cell${openCells.length === 1 ? "" : "s"} in the sample ${openCells.length === 1 ? "is" : "are"} still open`,
            goTo: "Go to the cells",
            onGoTo: () => jump("cells"),
          },
        ]
      : []),
  ];
  const questions: OpinionQuestion[] = (session.opinion?.questions ?? []).map((question) => {
    const answerText = opinion[question.key];
    const missing = question.required === true && !answerText && setup.dropAnswers.length > 0;
    return {
      id: question.key,
      question: question.label,
      required: question.required ?? false,
      kind: question.kind,
      ...(question.kind === "choice" ? { options: question.options } : {}),
      ...(question.kind === "scale" && question.min_label && question.max_label
        ? {
            help: `${question.min ?? 1} ${question.min_label} · ${question.max ?? 5} ${question.max_label}`,
          }
        : {}),
      ...(answerText ? { answer: answerText } : {}),
      ...(missing ? { missing: true } : {}),
    };
  });
  const missingQuestions = questions
    .map((question, position) => ({ question, position }))
    .filter(({ question }) => question.required && !opinion[question.id]);
  const doneBlockers: Blocker[] = counts.open
    ? blockers
    : missingQuestions.map(({ question, position }) => ({
        id: question.id,
        text: `Question ${position + 1} is not answered`,
        goTo: "Answer it",
      }));
  const nextLabel = session.neighbours
    ? `Submit and open slide ${session.neighbours.position + 1}`
    : "Submit";

  const authorOfNotes = person(session.meId);
  const kept = answer(currentId);
  const note: ReactNode =
    noteFor !== null && current ? (
      <NoteEditor
        object={currentId}
        reasons={disagreeOpen ? [] : noteReasonsFor(current.kind, setup.pending ?? kept?.value)}
        chosen={noteDraft.reasons}
        text={noteDraft.text}
        offReason={setup.connLost ? netOff : undefined}
        onReason={(reason) =>
          setNoteDraft({
            ...noteDraft,
            reasons: noteDraft.reasons.includes(reason)
              ? noteDraft.reasons.filter((item) => item !== reason)
              : [...noteDraft.reasons, reason],
          })
        }
        onText={(text) => setNoteDraft({ ...noteDraft, text })}
        onSave={saveNote}
        onCancel={() => setNoteFor(null)}
      />
    ) : kept && (kept.note || (kept.reasons.length && !disagreeOpen)) ? (
      <SavedNote
        answer={kept}
        label={answerLabel(style, kept, session.classes)}
        author={authorOfNotes}
        onEdit={openNote}
      />
    ) : kept || setup.pending ? (
      <button
        type="button"
        onClick={openNote}
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-body-sm font-medium text-fg-dim hover:text-fg"
      >
        <Icon name="comment" />
        Add a note
        <Keycap keys="N" size="sm" />
      </button>
    ) : null;

  const coachTips = setup.coach ? (
    <div className="grid gap-3">
      <CoachTip n={3}>
        Answer with one of the buttons, or press{" "}
        {answersOf(style, session.classes, current)
          .map((item) => item.key)
          .join(", ")
          .replace(/, ([^,]*)$/, " or $1")}
        .
      </CoachTip>
      <CoachTip n={4}>
        The next object comes by itself. The dots take you back to any of them.
      </CoachTip>
      <Button
        variant="primary"
        size="lg"
        className="w-fit"
        onClick={() =>
          void navigate({
            to: "/tasks/$taskId/guided",
            params: { taskId: session.taskId },
            search: { slide: session.slideId, scene: "region" },
          })
        }
      >
        Got it, start
      </Button>
    </div>
  ) : null;

  const issueCard =
    setup.issue === "withdrawn" ? (
      <IssueCard
        icon="info"
        title={`${session.task?.code ?? "The task"} was withdrawn`}
        body={`${person(session.task?.created_by_user_id)?.name ?? "The researcher"} withdrew ${session.task?.code ?? "the task"} on 16 Oct. Your 7 decided slides are kept and show in the report.`}
        action={
          <Button
            variant="primary"
            size="lg"
            className="w-fit"
            onClick={() => void navigate({ to: "/my-work" })}
          >
            <Icon name="back" />
            Back to My work
          </Button>
        }
      />
    ) : noResults ? (
      <IssueCard
        icon="smart"
        title="Nothing to decide here yet."
        body={`${session.slideName.split(" ")[0]} has no ${setName} result in ${session.task?.code ?? "this task"}. Look at it without AI in the full viewer, or go on to the next slide.`}
        action={
          <Button variant="primary" size="lg" className="w-fit" onClick={() => void toSubmitted()}>
            Next slide
            <Icon name="next" />
          </Button>
        }
      />
    ) : null;

  const reviewBody = issueCard ? (
    issueCard
  ) : showDone ? (
    <SlideDoneCard
      className="min-h-full"
      slideNumber={session.neighbours?.position ?? 1}
      counts={{ ...counts, added: session.added.length }}
      questions={questions}
      blockers={doneBlockers}
      submitLabel={nextLabel}
      failed={failed}
      onSubmit={submit}
      onAnswerChange={(id, value) => setOpinion({ ...opinion, [id]: value })}
    />
  ) : current ? (
    <div className="flex min-h-full flex-col gap-5">
      <ObjectCard
        position={index + 1}
        total={objects.length}
        object={current}
        dots={
          <ObjectDots
            regions={regions}
            cells={cells}
            current={currentId}
            answer={answer}
            skipped={setup.showSkipped ? objects.map((item) => item.object) : []}
            onJump={jump}
          />
        }
        text={cardText(style, current, confidence)}
        style={style}
        classes={session.classes}
        answer={kept}
        pending={
          setup.pending && noteFor !== null ? setup.pending : setup.connLost ? setup.pending : null
        }
        lockLine={lockLine}
        disabled={buttonsOff}
        disagreeOpen={disagreeOpen}
        note={note}
        coach={coachTips}
        onAnswer={answerWith}
        onReason={toggleReason}
        onBackToAnswers={() => setDisagreeOpen(false)}
        onFix={(what) =>
          setToast({
            id: Date.now(),
            text:
              what === "outline"
                ? "Redraw the outline in the full viewer (prototype)"
                : "Pick the right class with 1 to 4 (prototype)",
          })
        }
        onAddMissed={() =>
          setToast({
            id: Date.now(),
            text: `Draw around what the AI missed. It becomes T${regions.length + 2}⁺ (prototype)`,
          })
        }
      />
      <div className="mt-auto flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          disabled={index === 0}
          title={index === 0 ? "This is the first object" : undefined}
          onClick={() => goTo(index - 1)}
        >
          <Icon name="back" />
          Previous
        </Button>
        <Button variant="ghost" onClick={() => goTo(index + 1)}>
          {kept ? "Next" : "Skip for now"}
          <Icon name="next" />
        </Button>
      </div>
    </div>
  ) : null;

  const commentsBody =
    showDone || noResults ? (
      <ThreadList
        slideLabel={session.slideName.split(" ")[0] ?? ""}
        threads={noResults ? [] : session.threads}
        onOpen={(anchor) => {
          jump(anchor);
          onTabChange("comments");
        }}
      />
    ) : (
      <ObjectComments
        object={currentId}
        threads={session.threads}
        meId={session.meId}
        blind={session.task?.blinded ?? false}
        blindReviewers={blindReviewers}
        initialDraft={setup.commentDraft}
        offReason={setup.connLost ? netOff : undefined}
        onSent={(text) =>
          setToast({
            id: Date.now(),
            text: `Comment added on ${currentId}. It shows in the full viewer too${text.includes("@") ? ", and the people you mention are told" : ""}.`,
          })
        }
      />
    );

  const banner = setup.connLost ? (
    <Banner
      tone="warn"
      actions={
        <Button size="sm" onClick={() => setToast({ id: Date.now(), text: "Still offline" })}>
          Retry now
        </Button>
      }
    >
      <b>Connection lost.</b> Decisions can't be saved right now. Nothing is lost. Retrying...
    </Banner>
  ) : setup.readOnly ? (
    <Banner
      tone="info"
      icon="lock"
      actions={
        <Button size="sm">
          Ask {person(session.task?.created_by_user_id)?.name.split(" ")[0] ?? "the researcher"} to
          amend
        </Button>
      }
    >
      <b>Signed off 15 Oct.</b> Changes need an amendment.
    </Banner>
  ) : submitted && !showDone ? (
    <Banner tone="info">
      You submitted this slide. Changes are saved and {otherReviewer} is told.
    </Banner>
  ) : null;

  const canvasIssue = tileFail ? (
    <CanvasNotice
      icon="warn"
      title={`${session.slideName.split(" ")[0]} could not be read at 20x and 40x.`}
      actions={
        <>
          <Button variant="primary">Retry</Button>
          <Button>Ask the researcher</Button>
        </>
      }
    >
      Tiles are missing on the server. Lower magnifications still show, and your other slides work.
    </CanvasNotice>
  ) : noResults ? (
    <CanvasNotice
      icon="smart"
      title={`No ${setName} result on ${session.slideName.split(" ")[0]} yet.`}
      actions={<Button>Ask the researcher</Button>}
    >
      Review the slide without AI, or ask the researcher to run the model.
    </CanvasNotice>
  ) : null;

  return (
    <main className="flex h-dvh min-w-0 flex-col bg-page text-fg" data-scene={scene ?? "region"}>
      <ReviewTop
        mode="guided"
        session={session}
        counts={counts}
        onWholeSlide={() => setWhole(true)}
        nothingToDecide={noResults}
        submitReason={noResults ? "Nothing to decide on this slide" : submitReason}
        onSubmit={() => {
          setShowDone(true);
          setWhole(true);
          onTabChange("review");
        }}
      />
      {banner}
      <div className="flex min-h-0 flex-1">
        <SlideStill
          view={view}
          camera={camera}
          onCameraChange={setCamera}
          regionDecisions={regionDecisions}
          cellDecisions={cellDecisions}
          ringedCells={confirmRest ? openCells.map((cell) => cell.object) : []}
          claimHidden={!showsClaim(style)}
          drawAs={settings.draw}
          showIds={settings.ids}
          failed={tileFail}
          bare={noResults}
          minimap={!noResults}
          hint={!showDone && !noResults}
          slideName={session.slideName}
          overlay={({ camera: shown, moved }) => (
            <>
              {canvasIssue}
              {setup.coach ? (
                <>
                  <CoachTip n={1} className="absolute top-[45%] left-[35%] w-75">
                    The AI found this. It is outlined in white.
                  </CoachTip>
                  <CoachTip n={2} className="absolute bottom-24 left-4 w-85">
                    Drag to move around. Scroll or use + and − to zoom. Back to {currentId} brings
                    you back.
                  </CoachTip>
                </>
              ) : null}
              {view.kind === "whole" && cells.length && !noResults ? (
                <CellCluster
                  className="absolute top-[50%] left-[54%]"
                  split={countAnswers(cells, answer)}
                  onClick={() => {
                    setWhole(false);
                    setShowDone(false);
                    jump("cells");
                  }}
                />
              ) : null}
              {current?.kind === "cell" && !showDone && !noResults ? (
                cellsShut ? (
                  <CellsLauncher
                    className="absolute bottom-18 left-1/2 -translate-x-1/2"
                    decided={cells.length - openCells.length}
                    total={cells.length}
                    onClick={() => setCellsShut(false)}
                  />
                ) : (
                  <CellsGrid
                    className="absolute bottom-18 left-1/2 w-fit -translate-x-1/2"
                    cells={cells}
                    current={currentId}
                    answer={answer}
                    answerKeys={answersOf(style, session.classes, current).map((item) => item.key)}
                    claimHidden={!showsClaim(style)}
                    folded={cellsFolded}
                    confirming={confirmRest}
                    onPick={(object) => jump(object)}
                    onAgreeRest={() => setConfirmRest(true)}
                    onCancelRest={() => setConfirmRest(false)}
                    onApplyRest={() => {
                      const next = new Map(overrides);
                      for (const cell of openCells) {
                        next.set(cell.object, {
                          value: "agree",
                          raw: "agree",
                          reasons: [],
                          note: null,
                        });
                      }
                      setOverrides(next);
                      setConfirmRest(false);
                      setToast({
                        id: Date.now(),
                        text: `${openCells.length} cells marked agree`,
                        undo: () => setOverrides(overrides),
                      });
                    }}
                    onFoldChange={setCellsFolded}
                    onClose={() => setCellsShut(true)}
                  />
                )
              ) : null}
              {noResults ? null : (
                <div className="absolute bottom-4 left-4 flex items-center gap-2">
                  {showDone ? null : (
                    <Button
                      size="lg"
                      variant={moved && !confirmRest ? "primary" : "secondary"}
                      title={`Center ${currentId} again`}
                      onClick={() => {
                        setCamera(null);
                        setWhole(false);
                      }}
                    >
                      <Icon name="target" />
                      Back to {currentId}
                    </Button>
                  )}
                  <fieldset
                    aria-label="Zoom"
                    className="m-0 inline-flex h-10 min-w-0 items-center rounded-ctl border border-line-strong bg-btn-bg p-0"
                  >
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label="Zoom out"
                      title="Zoom out (−)"
                      onClick={() => setCamera({ ...shown, scale: shown.scale / 1.4 })}
                    >
                      <Icon name="minus" />
                    </Button>
                    <span
                      className="min-w-14 text-center font-mono text-body-sm font-semibold"
                      title="Magnification on screen"
                    >
                      {readout(view, shown)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label="Zoom in"
                      title="Zoom in (+)"
                      onClick={() => setCamera({ ...shown, scale: shown.scale * 1.4 })}
                    >
                      <Icon name="plus" />
                    </Button>
                  </fieldset>
                  <Button
                    size="lg"
                    className={
                      view.kind === "whole"
                        ? "border-accent bg-[color-mix(in_srgb,var(--accent)_18%,var(--chrome))]"
                        : undefined
                    }
                    aria-pressed={view.kind === "whole"}
                    title={view.kind === "whole" ? `Back to ${currentId}` : "See the whole slide"}
                    onClick={() => {
                      setCamera(null);
                      setWhole(view.kind !== "whole");
                      if (view.kind === "whole") setShowDone(false);
                    }}
                  >
                    <Icon name="expand" />
                    Whole slide
                  </Button>
                </div>
              )}
              {toast ? (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <UndoToast
                    key={toast.id}
                    message={toast.text}
                    {...(toast.undo ? { onUndo: toast.undo } : {})}
                    onExpire={() => setToast(null)}
                  />
                </div>
              ) : null}
            </>
          )}
        />
        <SidePanel
          width={470}
          variant="quiet"
          value={tabNow}
          onValueChange={(next) => onTabChange(next as GuidedTab)}
          tabs={[
            { value: "review", label: "Review", body: reviewBody },
            {
              value: "comments",
              label: "Comments",
              ...(messages.length && !showDone ? { count: messages.length } : {}),
              ...(showDone && session.threads.length ? { count: session.threads.length } : {}),
              body: commentsBody,
            },
            {
              value: "display",
              label: "Display",
              body: (
                <DisplayTab
                  display={session.display}
                  preset={setup.preset}
                  extraLocks={extraLocks}
                />
              ),
            },
          ]}
        />
      </div>
    </main>
  );
}

function CoachTip({
  n,
  children,
  className,
}: {
  n: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-zone bg-[#0ea5e9] px-3.5 py-3 text-body-sm leading-[1.45] text-white shadow-pop",
        className,
      )}
    >
      <b className="grid size-5.5 shrink-0 place-items-center rounded-full bg-white text-caption text-[#0369a1]">
        {n}
      </b>
      <span>{children}</span>
    </div>
  );
}

export function IssueCard({
  icon,
  title,
  body,
  action,
}: {
  icon: "info" | "smart";
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div className="grid justify-items-start gap-3">
      <Icon name={icon} size="lg" className="text-fg-dim" />
      <h2 className="m-0 text-title-sm font-semibold">{title}</h2>
      <p className="m-0 text-body leading-[1.5] text-fg-dim">{body}</p>
      {action}
    </div>
  );
}

export function CanvasNotice({
  icon,
  title,
  actions,
  children,
}: {
  icon: "warn" | "smart" | "info";
  title: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="absolute top-4 left-1/2 w-[min(760px,calc(100%-2rem))] -translate-x-1/2">
      <InlineState
        icon={icon}
        title={title}
        action={<span className="flex gap-2">{actions}</span>}
        className="border-solid shadow-pop"
      >
        {children}
      </InlineState>
    </div>
  );
}
