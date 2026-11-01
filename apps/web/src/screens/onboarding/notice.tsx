import { Toast, UndoToast } from "@parfocal/ui/components/undo-toast";
import { type ReactNode, useEffect, useState } from "react";

type Notice = { id: number; message: ReactNode; undo?: () => void };

export function useNotice(): [ReactNode, (message: ReactNode, undo?: () => void) => void] {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (notice === null || notice.undo) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const show = (message: ReactNode, undo?: () => void) =>
    setNotice({ id: Date.now(), message, ...(undo ? { undo } : {}) });
  const node = notice ? (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-60 flex justify-center">
      <div className="pointer-events-auto">
        {notice.undo ? (
          <UndoToast
            key={notice.id}
            message={notice.message}
            onUndo={notice.undo}
            duration={6000}
            onExpire={() => setNotice(null)}
          />
        ) : (
          <Toast key={notice.id}>{notice.message}</Toast>
        )}
      </div>
    </div>
  ) : null;
  return [node, show];
}
