import {
  createThread,
  createThreadOnSlide,
  deleteThread,
  deleteThreadOnSlide,
  getGetThreadOnSlideQueryKey,
  getGetThreadQueryKey,
  getListThreadsOnSlideQueryKey,
  getListThreadsQueryKey,
  getThread,
  getThreadOnSlide,
  type MessageCreate,
  moveThread,
  moveThreadOnSlide,
  type PinMove,
  reopenThread,
  reopenThreadOnSlide,
  replyToThread,
  replyToThreadOnSlide,
  resolveThread,
  resolveThreadOnSlide,
  type Thread,
  type ThreadCreate,
} from "@parfocal/api-client";

export type ThreadHome = {
  projectId: string;
  slideId: string;
  taskId: string | null;
};

export const homeOf = (thread: Thread): ThreadHome => ({
  projectId: thread.project_id,
  slideId: thread.slide_id,
  taskId: thread.task_id,
});

export const threadListKey = ({ projectId, slideId, taskId }: ThreadHome) =>
  taskId === null
    ? getListThreadsOnSlideQueryKey(projectId, slideId)
    : getListThreadsQueryKey(taskId, slideId);

export const threadKey = ({ projectId, slideId, taskId }: ThreadHome, threadId: string) =>
  taskId === null
    ? getGetThreadOnSlideQueryKey(projectId, slideId, threadId)
    : getGetThreadQueryKey(taskId, slideId, threadId);

export const readThread = ({ projectId, slideId, taskId }: ThreadHome, threadId: string) =>
  taskId === null
    ? getThreadOnSlide(projectId, slideId, threadId)
    : getThread(taskId, slideId, threadId);

export const startThread = ({ projectId, slideId, taskId }: ThreadHome, data: ThreadCreate) =>
  taskId === null
    ? createThreadOnSlide(projectId, slideId, data)
    : createThread(taskId, slideId, data);

export const replyInThread = (
  { projectId, slideId, taskId }: ThreadHome,
  threadId: string,
  data: MessageCreate,
) =>
  taskId === null
    ? replyToThreadOnSlide(projectId, slideId, threadId, data)
    : replyToThread(taskId, slideId, threadId, data);

export const markResolved = (
  { projectId, slideId, taskId }: ThreadHome,
  threadId: string,
  resolved: boolean,
) => {
  if (taskId === null) {
    return resolved
      ? resolveThreadOnSlide(projectId, slideId, threadId)
      : reopenThreadOnSlide(projectId, slideId, threadId);
  }
  return resolved
    ? resolveThread(taskId, slideId, threadId)
    : reopenThread(taskId, slideId, threadId);
};

export const moveThreadPin = (
  { projectId, slideId, taskId }: ThreadHome,
  threadId: string,
  data: PinMove,
) =>
  taskId === null
    ? moveThreadOnSlide(projectId, slideId, threadId, data)
    : moveThread(taskId, slideId, threadId, data);

export const removeThread = ({ projectId, slideId, taskId }: ThreadHome, threadId: string) =>
  taskId === null
    ? deleteThreadOnSlide(projectId, slideId, threadId, { confirm: true })
    : deleteThread(taskId, slideId, threadId, { confirm: true });

export type ResultSetName = (resultSetId: string) => string | undefined;

const slideScope = (thread: Thread, setName: ResultSetName) => {
  const resultSetId = thread.anchor.result_set_id;
  const name = resultSetId ? setName(resultSetId) : undefined;
  return name ? `Slide · ${name}` : "Slide";
};

export const threadScope = (
  thread: Thread,
  taskName: string | undefined,
  setName: ResultSetName = () => undefined,
) => (thread.task_id === null ? slideScope(thread, setName) : (taskName ?? "Task"));
