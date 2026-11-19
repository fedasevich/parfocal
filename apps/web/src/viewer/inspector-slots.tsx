import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

export const inspectorSections = ["objects", "display", "sets", "ai"] as const;

export type InspectorSection = (typeof inspectorSections)[number];

export type InspectorSlots = Partial<Record<InspectorSection, HTMLElement | null>>;

const SlotsContext = createContext<InspectorSlots | null>(null);

export const InspectorSlotsProvider = SlotsContext.Provider;

export const dockedCard =
  "grid gap-2 rounded-zone border border-surf-edge bg-surf-section p-3 text-caption";

export function useDocked(): boolean {
  return useContext(SlotsContext) !== null;
}

export function DockCard({
  section,
  order = 0,
  children,
}: {
  section: InspectorSection;
  order?: number;
  children: ReactNode;
}) {
  const slots = useContext(SlotsContext);
  if (slots === null) return <>{children}</>;
  const node = slots[section];
  if (!node) return null;
  return createPortal(
    <div data-dock-section={section} className="grid min-w-0" style={{ order }}>
      {children}
    </div>,
    node,
  );
}
