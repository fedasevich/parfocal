"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center text-fg-dim group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "justify-center rounded-ctl bg-seg-track p-0.5 group-data-horizontal/tabs:h-8",
        line: "justify-center gap-1 bg-transparent group-data-horizontal/tabs:h-8",
        page: "w-full gap-2 border-b border-line",
        panel: "w-full border-b border-line px-2",
        quiet: "w-full border-b border-line px-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center gap-1.5 border-0 bg-transparent font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:flex-1 group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:text-caption group-data-[variant=default]/tabs-list:text-fg-dim group-data-[variant=default]/tabs-list:hover:text-fg group-data-[variant=default]/tabs-list:data-active:bg-accent-soft group-data-[variant=default]/tabs-list:data-active:font-semibold group-data-[variant=default]/tabs-list:data-active:text-fg group-data-[variant=default]/tabs-list:data-active:shadow-[inset_0_0_0_1.5px_var(--accent)]",
        "group-data-[variant=line]/tabs-list:h-full group-data-[variant=line]/tabs-list:px-2 group-data-[variant=line]/tabs-list:text-body-sm group-data-[variant=line]/tabs-list:hover:text-fg group-data-[variant=line]/tabs-list:data-active:text-fg group-data-[variant=line]/tabs-list:data-active:shadow-[inset_0_-2px_0_var(--accent)]",
        "group-data-[variant=page]/tabs-list:-mb-px group-data-[variant=page]/tabs-list:border-b-2 group-data-[variant=page]/tabs-list:border-transparent group-data-[variant=page]/tabs-list:px-3 group-data-[variant=page]/tabs-list:py-2.5 group-data-[variant=page]/tabs-list:text-body group-data-[variant=page]/tabs-list:font-normal group-data-[variant=page]/tabs-list:text-fg-dim group-data-[variant=page]/tabs-list:hover:text-fg group-data-[variant=page]/tabs-list:data-active:border-accent group-data-[variant=page]/tabs-list:data-active:font-semibold group-data-[variant=page]/tabs-list:data-active:text-fg",
        "group-data-[variant=panel]/tabs-list:-mb-px group-data-[variant=panel]/tabs-list:border-b-2 group-data-[variant=panel]/tabs-list:border-transparent group-data-[variant=panel]/tabs-list:px-2.5 group-data-[variant=panel]/tabs-list:pt-2.5 group-data-[variant=panel]/tabs-list:pb-2.25 group-data-[variant=panel]/tabs-list:text-caption group-data-[variant=panel]/tabs-list:text-fg-faint group-data-[variant=panel]/tabs-list:hover:text-fg group-data-[variant=panel]/tabs-list:data-active:border-accent group-data-[variant=panel]/tabs-list:data-active:text-fg",
        "group-data-[variant=quiet]/tabs-list:-mb-px group-data-[variant=quiet]/tabs-list:border-b-2 group-data-[variant=quiet]/tabs-list:border-transparent group-data-[variant=quiet]/tabs-list:px-2.5 group-data-[variant=quiet]/tabs-list:pt-3 group-data-[variant=quiet]/tabs-list:pb-2.75 group-data-[variant=quiet]/tabs-list:text-body-sm group-data-[variant=quiet]/tabs-list:text-fg-faint group-data-[variant=quiet]/tabs-list:hover:text-fg-dim group-data-[variant=quiet]/tabs-list:data-active:border-accent group-data-[variant=quiet]/tabs-list:data-active:text-fg",
        className,
      )}
      {...props}
    />
  );
}

function TabCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tab-count"
      className={cn(
        "rounded-lg bg-chrome-3 px-1.25 py-0.5 font-mono text-label leading-none font-medium text-fg-dim",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-body-sm outline-none", className)}
      {...props}
    />
  );
}

export { TabCount, Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
