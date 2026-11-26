import type { ViewerModule } from "./magnification-control.tsx";
import { useViewerKeys } from "./use-viewer-keys.ts";
import type { ViewerEngine } from "./viewer-engine.ts";
import type { SelectionArea } from "./viewer-keys.ts";

export function ViewerKeys({
  session,
  selection,
}: {
  session: { readonly engine: ViewerEngine; readonly module: ViewerModule };
  selection: () => SelectionArea | null;
}) {
  useViewerKeys(session.engine, session.module, selection);
  return null;
}
