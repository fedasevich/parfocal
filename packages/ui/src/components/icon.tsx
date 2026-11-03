import { type IconName, iconNames, iconSet } from "@parfocal/ui/components/icon-set";
import { cn } from "@parfocal/ui/lib/utils";
import type { SVGProps } from "react";

const iconLabels = {
  select: "Select",
  hand: "Pan",
  smart: "Smart select",
  auto: "Find cells",
  poly: "Polygon",
  free: "Freehand",
  rect: "Rectangle",
  ellipse: "Ellipse",
  marker: "Point marker",
  ruler: "Ruler",
  arrow: "Arrow",
  text: "Text",
  comment: "Comment",
  brush: "Brush",
  slides: "Slides",
  sun: "Brightness",
  sliders: "Adjustments",
  gear: "Settings",
  help: "Help",
  share: "Share",
  back: "Back",
  next: "Next",
  popout: "Open in a new window",
  mouse: "Mouse",
  trackpad: "Trackpad",
  spacemouse: "3D mouse",
  gamepad: "Gamepad",
  keyboard: "Keyboard",
  frame: "Fit to screen",
  close: "Close",
  panel: "Side panel",
  home: "Home",
  down: "Down",
  check: "Done",
  warn: "Warning",
  eye: "Show",
  "eye-off": "Hide",
  plus: "Add",
  minus: "Remove",
  pause: "Pause",
  undo: "Undo",
  target: "Target",
  key: "Key",
  lock: "Locked",
  unlock: "Unlocked",
  caret: "Expand",
  pointer: "Pointer",
  pinch: "Pinch",
  pen: "Pen",
  search: "Search",
  flag: "Flag",
  more: "More",
  upload: "Upload",
  file: "File",
  folder: "Folder",
  info: "Information",
  user: "Person",
  board: "Board",
  link: "Link",
  logout: "Sign out",
  download: "Download",
  expand: "Full screen",
  bell: "Notifications",
  clock: "Time",
  calendar: "Date",
  users: "People",
  mail: "Email",
  flask: "Study",
  database: "Data",
  list: "List",
  parfocal: "Parfocal",
  layers: "Layers",
  monitor: "Display",
  shield: "Security",
  "x-circle": "Clear",
  "minus-circle": "Remove all",
} satisfies Record<IconName, string>;

const iconSizes = { xs: 12, sm: 16, md: 20, lg: 24, xl: 40 } as const;

const sizeClasses = {
  xs: "size-3",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
  xl: "size-10",
} as const;

type IconSize = keyof typeof iconSizes;

type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  size?: IconSize;
  label?: string | true;
};

function Icon({ name, size = "sm", label, className, ...props }: IconProps) {
  const { svg, body } = iconSet[name];
  const px = iconSizes[size];
  const spoken = label === true ? iconLabels[name] : label;
  return (
    <svg
      data-slot="icon"
      data-icon-name={name}
      viewBox="0 0 24 24"
      width={px}
      height={px}
      role="img"
      aria-label={spoken}
      aria-hidden={spoken ? undefined : true}
      className={cn("shrink-0", sizeClasses[size], className)}
      {...svg}
      {...props}
    >
      {body}
    </svg>
  );
}

export { Icon, type IconName, type IconProps, type IconSize, iconLabels, iconNames, iconSizes };
