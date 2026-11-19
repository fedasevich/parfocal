import { useEffect } from "react";

const scrollingOverflow = new Set(["auto", "scroll", "overlay"]);

function canScroll(node: Element, event: WheelEvent): boolean {
  const style = getComputedStyle(node);
  const vertical = scrollingOverflow.has(style.overflowY) && node.scrollHeight > node.clientHeight;
  const horizontal = scrollingOverflow.has(style.overflowX) && node.scrollWidth > node.clientWidth;
  if (vertical && event.deltaY !== 0) {
    const room = node.scrollHeight - node.clientHeight - node.scrollTop;
    if (event.deltaY < 0 ? node.scrollTop > 0 : room > 1) return true;
  }
  if (horizontal && event.deltaX !== 0) {
    const room = node.scrollWidth - node.clientWidth - node.scrollLeft;
    if (event.deltaX < 0 ? node.scrollLeft > 0 : room > 1) return true;
  }
  return false;
}

export function scrollsInside(target: Element, stop: Element, event: WheelEvent): boolean {
  for (let node: Element | null = target; node && node !== stop; node = node.parentElement) {
    if (canScroll(node, event)) return true;
  }
  return false;
}

const within = (point: number, low: number, high: number) => Math.min(Math.max(point, low), high);

export function useStageWheel(host: HTMLElement | null) {
  useEffect(() => {
    const stage = host?.parentElement;
    if (!host || !stage) return;
    const body = stage.closest<HTMLElement>('[data-slot="viewer-body"]') ?? stage;
    const view = host.ownerDocument;

    const blockPageZoom = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    const blockGesture = (event: Event) => event.preventDefault();

    const forward = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || host.contains(target)) return;
      const box = host.getBoundingClientRect();
      if (!event.ctrlKey) {
        const over =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom;
        if (!over || !stage.contains(target) || scrollsInside(target, stage, event)) return;
      }
      event.preventDefault();
      event.stopPropagation();
      host.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: within(event.clientX, box.left, box.right),
          clientY: within(event.clientY, box.top, box.bottom),
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        }),
      );
    };

    const options = { passive: false } as const;
    body.addEventListener("wheel", forward, options);
    view.addEventListener("wheel", blockPageZoom, options);
    view.addEventListener("gesturestart", blockGesture);
    view.addEventListener("gesturechange", blockGesture);
    return () => {
      body.removeEventListener("wheel", forward, options);
      view.removeEventListener("wheel", blockPageZoom, options);
      view.removeEventListener("gesturestart", blockGesture);
      view.removeEventListener("gesturechange", blockGesture);
    };
  }, [host]);
}
