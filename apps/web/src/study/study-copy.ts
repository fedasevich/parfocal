import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { FinalTextKey, TaskNoteKey } from "./study-model.ts";

export const giveUpAfterMs = 20_000;

export const readDelayMs = 5_000;

export const seqQuestion = msg`Overall, how difficult or easy was this task to complete?`;

export const seqEnds = { low: msg`Very difficult`, high: msg`Very easy` };

export const susItems: readonly MessageDescriptor[] = [
  msg`I think that I would like to use this system frequently.`,
  msg`I found the system unnecessarily complex.`,
  msg`I thought the system was easy to use.`,
  msg`I think that I would need the support of a technical person to be able to use this system.`,
  msg`I found the various functions in this system were well integrated.`,
  msg`I thought there was too much inconsistency in this system.`,
  msg`I would imagine that most people would learn to use this system very quickly.`,
  msg`I found the system very cumbersome to use.`,
  msg`I felt very confident using the system.`,
  msg`I needed to learn a lot of things before I could get going with this system.`,
];

export const susEnds = { low: msg`Strongly disagree`, high: msg`Strongly agree` };

export const taskNoteLabels: Record<TaskNoteKey, MessageDescriptor> = {
  like: msg`What did you like in this task?`,
  dislike: msg`What did you dislike?`,
  recommend: msg`What would you recommend?`,
};

export const finalQuestions: Record<
  FinalTextKey,
  { title: MessageDescriptor; hint: MessageDescriptor }
> = {
  like: {
    title: msg`What did you like?`,
    hint: msg`Think about the whole app. Write as much or as little as you want, or leave it empty.`,
  },
  dislike: {
    title: msg`What did you dislike?`,
    hint: msg`Anything that was hard, confusing or annoying. You can leave this empty.`,
  },
  missing: {
    title: msg`Was there anything you expected to find but could not?`,
    hint: msg`You can leave this empty.`,
  },
  recommend: {
    title: msg`What would you recommend?`,
    hint: msg`Anything we should change, add or keep as it is. You can leave this empty.`,
  },
};

export const giveUpReasons: readonly MessageDescriptor[] = [
  msg`I did not know where to look`,
  msg`I looked in several places and found nothing`,
  msg`I was not sure what the task asked for`,
  msg`Something did not work as I expected`,
  msg`Another reason`,
];

export const giveUpReasonKeys = [
  "where-to-look",
  "found-nothing",
  "unclear-task",
  "did-not-work",
  "other",
] as const;
