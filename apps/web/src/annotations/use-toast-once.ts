import { useEffect, useRef } from "react";
import { showUndoToast } from "../shell/undo-toasts.tsx";

export function useToastOnce(text: string | null): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (text === null) {
      last.current = null;
      return;
    }
    if (text === last.current) return;
    last.current = text;
    showUndoToast({ message: text });
  }, [text]);
}
