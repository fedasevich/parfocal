import { type ReactNode, useEffect, useRef } from "react";
import type { ScreenRect } from "./minimap-placement.ts";

export function MeasuredBlock({
  className,
  onRect,
  children,
}: {
  className: string;
  onRect: (rect: ScreenRect | null) => void;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const report = useRef(onRect);
  report.current = onRect;
  useEffect(() => {
    const node = element.current;
    const host = node?.offsetParent;
    if (!node || !host) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      const origin = host.getBoundingClientRect();
      report.current([box.left - origin.left, box.top - origin.top, box.width, box.height]);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(host);
    return () => {
      observer.disconnect();
      report.current(null);
    };
  }, []);
  return (
    <div ref={element} className={className}>
      {children}
    </div>
  );
}
