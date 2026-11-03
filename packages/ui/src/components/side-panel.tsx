import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type SidePanelTab = {
  value: string;
  label: string;
  count?: number;
  body: React.ReactNode;
  foot?: React.ReactNode;
};

type SidePanelProps = Omit<React.ComponentProps<"aside">, "defaultValue"> & {
  tabs: SidePanelTab[];
  defaultTab?: string;
  value?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  width?: number;
  variant?: "panel" | "quiet";
  dense?: boolean;
  head?: React.ReactNode;
};

function SidePanel({
  tabs,
  defaultTab,
  value,
  onValueChange,
  width = 340,
  variant = "panel",
  dense = false,
  head,
  className,
  ...props
}: SidePanelProps) {
  return (
    <aside
      data-slot="side-panel"
      aria-label="Side panel"
      className={cn("flex min-h-0 flex-col border-l border-line bg-chrome", className)}
      style={{ width }}
      {...props}
    >
      {head}
      <Tabs
        {...(value === undefined ? { defaultValue: defaultTab ?? tabs[0]?.value } : { value })}
        onValueChange={(next) => onValueChange?.(String(next))}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList
          variant={variant}
          className={cn(
            dense && "px-1 [&_[data-slot=tabs-trigger]]:gap-1! [&_[data-slot=tabs-trigger]]:px-1!",
          )}
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              {tab.count ? <TabCount>{tab.count}</TabCount> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="flex min-h-0 flex-1 flex-col">
            <div
              data-slot="side-panel-body"
              className="flex min-h-0 flex-1 flex-col gap-(--density-panel-gap) overflow-auto p-(--density-panel-pad)"
            >
              {tab.body}
            </div>
            {tab.foot ? (
              <div
                data-slot="side-panel-foot"
                className="grid gap-2.5 border-t border-line bg-chrome px-(--density-foot-x) pt-(--density-foot-top) pb-(--density-foot-bottom)"
              >
                {tab.foot}
              </div>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}

export { SidePanel, type SidePanelProps, type SidePanelTab };
