export type WorkingState = "working" | "failed";

export type ScreenFrame = { x: number; y: number; width: number; height: number };

type WorkingFrameProps = {
  testId: string;
  frame: ScreenFrame;
  state: WorkingState;
  kind: string;
};

export function WorkingFrame({ testId, frame, state, kind }: WorkingFrameProps) {
  return (
    <rect
      data-testid={testId}
      data-state={state}
      data-kind={kind}
      {...frame}
      fill="none"
      strokeWidth={2}
      strokeDasharray="6 4"
      className={state === "failed" ? "stroke-bad" : "pf-march stroke-accent"}
    />
  );
}

export function pointFrame(at: { x: number; y: number }, size = 28): ScreenFrame {
  return { x: at.x - size / 2, y: at.y - size / 2, width: size, height: size };
}
