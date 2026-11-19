import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ApiError } from "@parfocal/api-client";
import { useCallback } from "react";

const sentences: Record<string, MessageDescriptor> = {
  "layer-not-empty": msg`The slide has objects, so it is not empty.`,
  "slide-signed-off": msg`This slide is signed off and its layer is locked.`,
  "reason-needed": msg`Give a reason to change a signed-off slide.`,
  "no-result-set": msg`Add only a finished result set of the same slide.`,
  "experts-unchecked": msg`Every assigned expert has to check the slide first.`,
  "objects-unchecked": msg`The task needs every AI object checked before sign-off.`,
  "annotation-changed": msg`A colleague changed some of these cells, so nothing was changed. Look at them and try again.`,
  "not-assigned": msg`Only the people assigned to this task can do that. You can look at it read only.`,
  "unknown-object": msg`That object is no longer in this result, so nothing was changed. Reload the slide and try again.`,
  "project-owners-only": msg`Only an owner of this project can do that.`,
  "task-signed-off": msg`The task is signed off. An owner can reopen it.`,
  "already-submitted": msg`This slide is already submitted.`,
  network: msg`You are offline, so nothing was saved. Try again when the connection is back.`,
  "401": msg`Your session has ended. Sign in again to carry on.`,
  "403": msg`You do not have access to do that here.`,
  "404": msg`This was not found. It may have been moved or deleted.`,
  "409": msg`Someone changed this first. Reload to see the latest version, then try again.`,
};

const fallback = msg`That did not work, and nothing was changed. Reload the page and try again.`;

export const refusalCodeOf = (error: unknown) =>
  error instanceof ApiError ? (error.problem?.code ?? `${error.status}`) : "network";

const serverSentenceOf = (error: unknown) => {
  if (!(error instanceof ApiError)) return undefined;
  const detail = error.problem?.detail?.trim();
  return detail === undefined || detail === "" ? undefined : detail;
};

export function knownRefusal(code: string): MessageDescriptor | undefined {
  return sentences[code];
}

export function useRefusals() {
  const { t } = useLingui();
  const sentenceOf = useCallback(
    (code: string) => {
      const known = sentences[code];
      return known === undefined ? t(fallback) : t(known);
    },
    [t],
  );
  const refusalOf = useCallback(
    (error: unknown) => {
      const known = sentences[refusalCodeOf(error)];
      if (known !== undefined) return t(known);
      return serverSentenceOf(error) ?? t(fallback);
    },
    [t],
  );
  return { sentenceOf, refusalOf };
}
