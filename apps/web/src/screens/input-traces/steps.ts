import type { TraceDevice, TraceGestureName } from "./trace-format.ts";

export interface TraceStep {
  readonly id: string;
  readonly gesture: TraceGestureName;
  readonly variant?: string;
  readonly title: string;
  readonly instruction: string;
}

export interface DeviceProfile {
  readonly id: "mouse" | "mac-trackpad" | "windows-touchpad";
  readonly device: TraceDevice;
  readonly title: string;
  readonly summary: string;
  readonly optional: boolean;
  readonly steps: readonly TraceStep[];
}

const mouseSteps: readonly TraceStep[] = [
  {
    id: "scroll-down-slow",
    gesture: "scroll-down",
    variant: "slowly",
    title: "Mouse, scroll down slowly",
    instruction: "Turn the wheel down one notch at a time, with a short pause between notches.",
  },
  {
    id: "scroll-down-fast",
    gesture: "scroll-down",
    variant: "fast",
    title: "Mouse, scroll down fast",
    instruction: "Spin the wheel down quickly, as if you were skipping through a long page.",
  },
  {
    id: "scroll-up-slow",
    gesture: "scroll-up",
    variant: "slowly",
    title: "Mouse, scroll up slowly",
    instruction: "Turn the wheel up one notch at a time, with a short pause between notches.",
  },
  {
    id: "ctrl-wheel",
    gesture: "ctrl-wheel",
    title: "Mouse, Ctrl and wheel",
    instruction: "Hold Ctrl and turn the wheel up and then down.",
  },
  {
    id: "shift-wheel",
    gesture: "shift-wheel",
    title: "Mouse, Shift and wheel",
    instruction: "Hold Shift and turn the wheel up and then down.",
  },
  {
    id: "drag",
    gesture: "drag",
    title: "Mouse, drag with the left button",
    instruction: "Press the left button on the pad, drag across it in a wide curve and let go.",
  },
  {
    id: "middle-drag",
    gesture: "middle-drag",
    title: "Mouse, drag with the wheel button",
    instruction: "Press the wheel button on the pad, drag across it and let go.",
  },
  {
    id: "double-click",
    gesture: "double-click",
    title: "Mouse, double-click",
    instruction: "Double-click the left button once on the pad.",
  },
  {
    id: "alt-double-click",
    gesture: "alt-double-click",
    title: "Mouse, Alt and double-click",
    instruction: "Hold Alt and double-click the left button once on the pad.",
  },
];

function trackpadSteps(name: string, tap: string, twoFingerClick: string): readonly TraceStep[] {
  return [
    {
      id: "scroll-down-slow",
      gesture: "scroll-down",
      variant: "slowly",
      title: `${name}, scroll down slowly`,
      instruction: "Slide two fingers down the pad slowly and lift them. Let the glide fade out.",
    },
    {
      id: "scroll-down-flick",
      gesture: "scroll-down",
      variant: "flick",
      title: `${name}, flick down`,
      instruction: "Flick two fingers down quickly and let the momentum carry on.",
    },
    {
      id: "scroll-up-slow",
      gesture: "scroll-up",
      variant: "slowly",
      title: `${name}, scroll up slowly`,
      instruction: "Slide two fingers up the pad slowly and lift them.",
    },
    {
      id: "scroll-sideways",
      gesture: "scroll-sideways",
      title: `${name}, scroll sideways`,
      instruction: "Slide two fingers to the right and then to the left.",
    },
    {
      id: "pinch-out-slow",
      gesture: "pinch-out",
      variant: "slowly",
      title: `${name}, pinch out slowly`,
      instruction: "Spread two fingers apart slowly, as if you were zooming in.",
    },
    {
      id: "pinch-out-fast",
      gesture: "pinch-out",
      variant: "fast",
      title: `${name}, pinch out fast`,
      instruction: "Spread two fingers apart quickly in one sharp move.",
    },
    {
      id: "pinch-in-slow",
      gesture: "pinch-in",
      variant: "slowly",
      title: `${name}, pinch in slowly`,
      instruction: "Bring two fingers together slowly, as if you were zooming out.",
    },
    {
      id: "pinch-in-fast",
      gesture: "pinch-in",
      variant: "fast",
      title: `${name}, pinch in fast`,
      instruction: "Bring two fingers together quickly in one sharp move.",
    },
    {
      id: "double-click",
      gesture: "double-click",
      title: `${name}, double-click`,
      instruction: `${tap} twice quickly on the pad. If your pad has no tap to click, skip this step.`,
    },
    {
      id: "two-finger-click",
      gesture: "two-finger-click",
      title: `${name}, two-finger click`,
      instruction: `${twoFingerClick} once on the pad. If your pad has no two-finger click, skip this step.`,
    },
  ];
}

export const deviceProfiles: readonly DeviceProfile[] = [
  {
    id: "mouse",
    device: "mouse",
    title: "Mouse with a wheel",
    summary: "Needs a mouse with a wheel and a wheel button.",
    optional: false,
    steps: mouseSteps,
  },
  {
    id: "mac-trackpad",
    device: "trackpad",
    title: "Mac trackpad",
    summary: "The built-in trackpad of a MacBook or a Magic Trackpad.",
    optional: false,
    steps: trackpadSteps(
      "Mac trackpad",
      "Tap or click",
      "Click with two fingers resting on the pad, or hold Ctrl and click",
    ),
  },
  {
    id: "windows-touchpad",
    device: "trackpad",
    title: "Windows precision touchpad",
    summary: "Optional. Needs a Windows laptop with a precision touchpad.",
    optional: true,
    steps: trackpadSteps(
      "Windows touchpad",
      "Tap",
      "Tap with two fingers at once, or click the right half of the pad",
    ),
  },
];

export function profileById(id: string): DeviceProfile | undefined {
  return deviceProfiles.find((profile) => profile.id === id);
}
