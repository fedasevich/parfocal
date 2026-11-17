import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ExtrasSlot = {
  readonly node: HTMLElement | null;
  readonly place: (node: HTMLElement | null) => void;
};

const ExtrasContext = createContext<ExtrasSlot | null>(null);

export const contextChip =
  "inline-flex items-center rounded-ctl border border-line bg-chrome px-2 py-0.5 font-mono text-caption";

export function ContextExtrasHost({ children }: { children: ReactNode }) {
  const [node, place] = useState<HTMLElement | null>(null);
  const slot = useMemo(() => ({ node, place }), [node]);
  return <ExtrasContext.Provider value={slot}>{children}</ExtrasContext.Provider>;
}

export function ContextExtrasSlot() {
  const slot = useContext(ExtrasContext);
  if (slot === null) return null;
  return <span ref={slot.place} data-slot="context-extras" className="contents" />;
}

export function ContextExtra({ children }: { children: ReactNode }) {
  const slot = useContext(ExtrasContext);
  if (slot === null) return <>{children}</>;
  return slot.node ? createPortal(children, slot.node) : null;
}
