import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { Person, PersonAvatar } from "@parfocal/ui/components/person";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { useState } from "react";
import { usePeople } from "../people.ts";
import { lookUrl } from "../thumbnails.ts";
import { countWord } from "./decision-style.ts";
import { DisplayTab } from "./display-tab.tsx";
import { ObjectThread } from "./object-comments.tsx";
import { type ReviewSession, useReviewSession } from "./review-data.ts";
import { answerFromDecision, countAnswers } from "./review-state.ts";
import { ThreadsTab } from "./threads-tab.tsx";
import { AiSays, ObjectsSummary, ViewerFrame } from "./viewer-frame.tsx";

const kindOf = (anchor: string) =>
  anchor.endsWith("⁺") ? "Your ROI" : anchor.includes("·") ? "Cell" : "Tumor region";

type CommentsOnIdsProps = {
  taskId: string;
  slideId: string;
  thread: string | undefined;
  onThreadChange: (anchor: string) => void;
};

export function CommentsOnIds(props: CommentsOnIdsProps) {
  const session = useReviewSession(props.taskId, props.slideId);
  if (!session.ready) {
    return (
      <main className="grid h-dvh place-items-center bg-page text-fg-dim">Loading the slide…</main>
    );
  }
  return <CommentsBody session={session} {...props} />;
}

function CommentsBody({
  session,
  thread: picked,
  onThreadChange,
}: CommentsOnIdsProps & { session: ReviewSession }) {
  const [tab, setTab] = useState("comments");
  const person = usePeople();
  const openThreads = session.threads.filter((item) => !item.resolved).length;
  const anchor = picked ?? session.threads[0]?.anchor ?? "";
  const answers = (object: string) => {
    const decision = session.decisions.get(object);
    return decision
      ? answerFromDecision(
          decision,
          session.style,
          session.objects.find((item) => item.object === object),
          session.classes,
        )
      : undefined;
  };
  const counts = countAnswers(session.objects, answers);
  const notes = session.objects
    .map((item) => ({ object: item.object, answer: answers(item.object) }))
    .filter((item) => item.answer && (item.answer.note || item.answer.reasons.length));
  const me = person(session.meId);
  const slideLabel = session.slideName.split(" ")[0] ?? "";
  const blindReviewers = (session.task?.slides[0]?.reviewer_ids ?? []).filter(
    (id) => id !== session.meId,
  );
  return (
    <ViewerFrame
      session={session}
      counts={counts}
      tool="comment"
      tab={tab}
      onTabChange={setTab}
      tabs={[
        {
          value: "objects",
          label: "Objects",
          count: counts.total,
          body: (
            <>
              <ObjectsSummary
                slideLabel={slideLabel}
                counts={counts}
                added={session.added.map((item) => item.object)}
              />
              <AiSays setName="CAMELYON v1.0, imported 12 Oct" objects={session.objects} />
            </>
          ),
        },
        {
          value: "display",
          label: "Display",
          body: <DisplayTab display={session.display} preset={null} extraLocks={[]} viewer />,
        },
        {
          value: "comments",
          label: "Comments",
          count: openThreads,
          body: (
            <>
              <Zone>
                <ThreadsTab
                  taskId={session.taskId}
                  slideId={session.slideId}
                  slideLabel={slideLabel}
                  selected={anchor}
                  onOpen={onThreadChange}
                  onGoTo={onThreadChange}
                />
              </Zone>
              {notes.length ? (
                <Zone
                  title="Your decision notes"
                  end={<span className="font-mono text-caption text-fg-dim">{notes.length}</span>}
                >
                  <div className="grid gap-3">
                    {notes.map(({ object, answer }) => (
                      <div key={object} className="grid gap-1.5">
                        <span className="flex items-center gap-2.5">
                          <ObjectIdTag>{object}</ObjectIdTag>
                          <b className="text-body-sm font-semibold">
                            {answer ? countWord[answer.value] : ""}
                          </b>
                        </span>
                        {me ? <Person person={me} size={20} /> : null}
                        <span className="text-body-sm text-fg-dim">
                          {[answer?.reasons.join(", "), answer?.note ? `"${answer.note}"` : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </Zone>
              ) : null}
            </>
          ),
        },
        {
          value: "opinion",
          label: "Opinion",
          body: (
            <p className="m-0 text-body-sm text-fg-dim">
              The Slide done card with the opinion questions. It opens from Submit once every object
              is decided.
            </p>
          ),
        },
      ]}
    >
      <div
        className="relative min-w-0 flex-1 overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `url(${lookUrl("mid")})` }}
      >
        <span className="absolute top-[38%] left-[42%] inline-flex items-center">
          {me ? (
            <PersonAvatar
              person={person(session.task?.created_by_user_id) ?? me}
              size={28}
              className="shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_70%,white)]"
            />
          ) : null}
          <span className="ml-1 rounded-sm bg-black px-1 font-mono text-label font-semibold text-white">
            {anchor}
          </span>
        </span>
        <section
          aria-label={`Thread on ${anchor}`}
          className="absolute top-[37%] left-[calc(42%+48px)] grid w-82 gap-3 rounded-zone border border-line bg-chrome p-3.5 text-fg shadow-pop"
        >
          <div className="flex items-center gap-2.5">
            <ObjectIdTag>{anchor}</ObjectIdTag>
            <b className="flex-1 text-body-sm font-semibold">{kindOf(anchor)}</b>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close the thread"
              title="Close the thread"
            >
              <Icon name="close" />
            </Button>
          </div>
          <ObjectThread
            key={anchor}
            taskId={session.taskId}
            slideId={session.slideId}
            object={anchor}
            thread={session.threads.find((item) => item.anchor === anchor)}
            meId={session.meId}
            blind={session.task?.blinded ?? false}
            blindReviewers={blindReviewers}
          />
        </section>
        <div className="absolute right-4 bottom-4 grid w-50 gap-1.5 rounded-zone border border-line bg-chrome p-2 shadow-pop">
          <span className="flex items-center justify-between text-caption text-fg-dim">
            <span>
              <b className="text-fg">Whole slide</b> ·{" "}
              {session.threads.filter((item) => !item.resolved).length} threads
            </span>
            <Keycap action="peek" keys="Z" size="sm" />
          </span>
          <div
            aria-hidden="true"
            className="h-60 rounded-md bg-white bg-cover bg-center"
            style={{ backgroundImage: `url(${lookUrl("overview")})` }}
          />
          <span className="flex justify-between text-caption text-fg-dim">
            <span>{anchor}</span>
            <span>
              10× · {counts.decided} of {counts.total} decided
            </span>
          </span>
        </div>
        <MagnificationBar
          className="absolute bottom-4 left-1/2 -translate-x-1/2"
          magnification={10}
          scaleLabel="100 µm"
          scalePx={92}
          micronsPerPixel={1.13}
          open
        />
      </div>
    </ViewerFrame>
  );
}
