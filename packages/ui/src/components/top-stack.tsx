import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

const TopStackContext = createContext<HTMLElement | null>(null);

const orderClass = { bar: "order-1", wait: "order-2", alert: "order-3" } as const;

type TopStackOrder = keyof typeof orderClass;

function TopStackProvider({
  node,
  children,
}: {
  node: HTMLElement | null;
  children: React.ReactNode;
}) {
  return <TopStackContext value={node}>{children}</TopStackContext>;
}

function TopStack({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="top-stack"
      data-minimap-block
      className={cn(
        "pointer-events-none absolute top-3 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col items-center gap-2 empty:hidden",
        className,
      )}
      {...props}
    />
  );
}

function useTopStacked(): boolean {
  return useContext(TopStackContext) !== null;
}

function IntoTopStack({ order, children }: { order: TopStackOrder; children: React.ReactNode }) {
  const node = useContext(TopStackContext);
  if (node === null) return children;
  return createPortal(
    <div className={cn("pointer-events-auto max-w-full", orderClass[order])}>{children}</div>,
    node,
  );
}

export { IntoTopStack, TopStack, TopStackProvider, useTopStacked };
