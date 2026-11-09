import { useEffect, useState } from "react";
import { captureRedacted } from "./capture.ts";
import FeedbackDialog, { type Captured } from "./feedback-dialog.tsx";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function redactedScreenshot(): Promise<string | null> {
  try {
    await nextFrame();
    await nextFrame();
    return await captureRedacted(document);
  } catch {
    return null;
  }
}

export default function FeedbackFlow({ route, onClose }: { route: string; onClose: () => void }) {
  const [captured, setCaptured] = useState<Captured>();
  useEffect(() => {
    let live = true;
    void redactedScreenshot().then((screenshot) => {
      if (live) setCaptured({ screenshot, viewport: [window.innerWidth, window.innerHeight] });
    });
    return () => {
      live = false;
    };
  }, []);
  return captured ? <FeedbackDialog feedback={captured} route={route} onClose={onClose} /> : null;
}
