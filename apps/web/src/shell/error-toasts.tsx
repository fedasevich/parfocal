import { type ApiError, isDraftNotAvailable } from "@parfocal/api-client";
import { ErrorToast } from "@parfocal/ui/components/error-toast";
import { describeApiError, type ErrorNotice } from "@parfocal/ui/lib/api-error";
import { useSyncExternalStore } from "react";

type Shown = { id: number; notice: ErrorNotice };

const shownAtOnce = 3;
const visibleMs = 10_000;

let shown: Shown[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

const publish = (next: Shown[]) => {
  shown = next;
  for (const listener of listeners) listener();
};

const dismiss = (id: number) => publish(shown.filter((item) => item.id !== id));

export const notAvailableNotice: ErrorNotice = {
  kind: "not-found",
  tone: "warn",
  title: "Not available yet",
  message: "This part of Parfocal is still being built. Nothing was changed.",
  action: undefined,
};

export const noticeFor = (error: ApiError): ErrorNotice =>
  isDraftNotAvailable(error) ? notAvailableNotice : describeApiError(error);

export function showErrorToast(error: ApiError): void {
  const notice = noticeFor(error);
  const id = nextId++;
  const others = shown.filter(
    (item) => item.notice.title !== notice.title || item.notice.message !== notice.message,
  );
  publish([...others, { id, notice }].slice(-shownAtOnce));
  setTimeout(() => dismiss(id), visibleMs);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const actionFor = (notice: ErrorNotice) => {
  if (notice.action === "reload") return () => window.location.reload();
  if (notice.action === "sign-in") return () => window.location.assign("/sign-in");
  return undefined;
};

export function ErrorToasts() {
  const items = useSyncExternalStore(subscribe, () => shown);
  if (items.length === 0) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 grid gap-2">
      {items.map(({ id, notice }) => (
        <ErrorToast
          key={id}
          notice={notice}
          onAction={actionFor(notice)}
          onDismiss={() => dismiss(id)}
        />
      ))}
    </div>
  );
}
