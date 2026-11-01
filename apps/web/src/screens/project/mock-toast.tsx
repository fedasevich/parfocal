import { Toast, UndoToast } from "@parfocal/ui/components/undo-toast";
import { type ReactNode, useEffect, useState } from "react";

type Shown = { id: number; message: ReactNode; onUndo?: (() => void) | undefined };

export function useMockToast() {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    if (shown === null || shown.onUndo) return;
    const timer = setTimeout(() => setShown(null), 3200);
    return () => clearTimeout(timer);
  }, [shown]);
  const show = (message: ReactNode, onUndo?: () => void) =>
    setShown({ id: Date.now(), message, onUndo });
  const node =
    shown === null ? null : (
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-60 flex justify-center">
        <div className="pointer-events-auto">
          {shown.onUndo ? (
            <UndoToast
              key={shown.id}
              message={shown.message}
              onUndo={shown.onUndo}
              onExpire={() => setShown(null)}
            />
          ) : (
            <Toast key={shown.id}>{shown.message}</Toast>
          )}
        </div>
      </div>
    );
  return { node, show };
}
