import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ParticipantListing,
  participantProjectName,
  participantProjectOf,
  studySlideLabels,
  studyTaskNames,
} from "../src/study/participant-project.ts";
import { resolveStartPath, type StudyContext, type StudyTask } from "../src/study/study-model.ts";

const listing: ParticipantListing = {
  projects: [
    { id: "p-1", name: "Study P1" },
    { id: "p-2", name: "Study P2" },
  ],
  tasks: [
    { id: "r-1", name: studyTaskNames.review, projectId: "p-1" },
    { id: "q-1", name: studyTaskNames.queue, projectId: "p-1" },
    { id: "a-1", name: studyTaskNames.annotate, projectId: "p-1" },
    { id: "r-2", name: studyTaskNames.review, projectId: "p-2" },
    { id: "q-2", name: studyTaskNames.queue, projectId: "p-2" },
    { id: "a-2", name: studyTaskNames.annotate, projectId: "p-2" },
    { id: "c-1", name: studyTaskNames.cells, projectId: "p-1" },
    { id: "c-2", name: studyTaskNames.cells, projectId: "p-2" },
  ],
  slides: ["p-1", "p-2"].flatMap((project) =>
    Object.values(studySlideLabels).map((label) => ({
      id: `${project}-${label}`,
      label,
      project: { id: project },
    })),
  ),
};

const reviewTask: StudyTask = {
  id: "s1",
  title: "Review",
  instruction: "Review the first slide.",
  startPath: "/projects/{studyProject}/slides/{reviewSlide}?task={reviewTask}",
};

test("a participant code names its project", () => {
  assert.equal(participantProjectName(" p1 "), "Study P1");
});

test("a study task's start path resolves inside the participant's project", () => {
  const participant = participantProjectOf("p2", listing);
  assert.ok(participant);
  const context: StudyContext = { slides: listing.slides, resume: null, participant };
  assert.equal(
    resolveStartPath(reviewTask, context),
    "/projects/p-2/slides/p-2-Study review 1?task=r-2",
  );
  const queue = { ...reviewTask, startPath: "/tasks/{queueTask}/disagreements" };
  assert.equal(resolveStartPath(queue, context), "/tasks/q-2/disagreements");
  const annotate = {
    ...reviewTask,
    startPath: "/projects/{studyProject}/slides/{annotateSlide}?task={annotateTask}",
  };
  assert.equal(
    resolveStartPath(annotate, context),
    "/projects/p-2/slides/p-2-Study annotate?task=a-2",
  );
  const cells = {
    ...reviewTask,
    startPath: "/projects/{studyProject}/slides/{cellSlide}?task={cellTask}",
  };
  assert.equal(resolveStartPath(cells, context), "/projects/p-2/slides/p-2-Study cells?task=c-2");
});

test("a participant start path waits until the project is seeded", () => {
  assert.equal(participantProjectOf("p3", listing), undefined);
  const context: StudyContext = { slides: [], resume: null };
  assert.equal(resolveStartPath(reviewTask, context), undefined);
});

test("a half seeded participant project is not offered", () => {
  const partial = { ...listing, tasks: listing.tasks.filter((task) => task.id !== "q-1") };
  assert.equal(participantProjectOf("P1", partial), undefined);
});
