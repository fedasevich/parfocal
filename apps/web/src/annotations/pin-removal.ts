const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const removalTitle = (count: number) => `Delete ${plural(count, "comment thread")}?`;

export function removalDetail(
  threadIds: readonly string[],
  threads: readonly { id: string; message_count: number }[],
): string {
  const replies = threads
    .filter((thread) => threadIds.includes(thread.id))
    .reduce((total, thread) => total + Math.max(thread.message_count - 1, 0), 0);
  const withReplies = replies > 0 ? ` and ${replies} ${replies === 1 ? "reply" : "replies"}` : "";
  return `This removes ${plural(threadIds.length, "comment thread")}${withReplies} for everyone. Undo does not bring them back.`;
}
