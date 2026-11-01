import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { Icon } from "../../src/components/icon.tsx";

export function KitPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 bg-surf-page p-8 text-body-sm text-fg">
      <div>
        <h1 className="m-0 text-title font-semibold">{title}</h1>
        <p className="mt-1 mb-0 max-w-[80ch] text-fg-dim">{intro}</p>
      </div>
      {children}
    </div>
  );
}

export function Frame({
  label,
  children,
  flush = false,
  className,
}: {
  label: string;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("relative min-w-0", className)} aria-label={label}>
      <h2 className="m-0 mb-1.5 ml-0.5 flex items-center gap-2 text-caption font-normal text-fg-dim">
        <Icon name="frame" size="xs" />
        <b className="font-medium">{label}</b>
      </h2>
      <div
        className={cn(
          "rounded-md border border-line bg-surf-panel shadow-[0_1px_2px_rgb(0_0_0/0.06)]",
          flush ? "overflow-hidden" : "p-5",
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-6">
      {children}
    </div>
  );
}

export function Tight({ items }: { items: string[] }) {
  return (
    <ul className="m-0 pl-4.5">
      {items.map((item) => (
        <li key={item} className="my-0.5 text-fg-dim">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function BothThemes({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {(["dark", "light"] as const).map((theme) => (
        <div
          key={theme}
          data-theme={theme}
          className={cn("grid gap-3 rounded-lg bg-chrome p-4 text-fg", className)}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

export function RulesTable({
  head,
  rows,
}: {
  head: string[];
  rows: Array<[string, ...React.ReactNode[]]>;
}) {
  return (
    <table className="w-full border-collapse text-body-sm">
      <thead>
        <tr>
          {head.map((cell) => (
            <th
              key={cell}
              className="border-b border-line-strong px-2.5 py-2 text-left text-label font-semibold tracking-[0.06em] text-fg-faint uppercase"
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, index) => (
              <td
                key={`${row[0]}-${head[index] ?? index}`}
                className={cn(
                  "border-b border-line p-2.5 align-top",
                  index === 0 ? "font-semibold text-fg" : "text-fg-dim",
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
