import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export function useWorklistLive(me: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (me === undefined) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("./connect-worklist-live.ts").then(({ connectWorklistLive }) => {
      if (!cancelled) stop = connectWorklistLive(queryClient, me);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [queryClient, me]);
}
