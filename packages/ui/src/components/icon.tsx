import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { type IconName, iconNames, iconSet } from "@parfocal/ui/components/icon-set";
import { cn } from "@parfocal/ui/lib/utils";
import type { SVGProps } from "react";

const iconLabels = {
  select: msg`Select`,
  hand: msg`Pan`,
  smart: msg`Smart select`,
  auto: msg`Find cells`,
  poly: msg`Polygon`,
  free: msg`Freehand`,
  rect: msg`Rectangle`,
  ellipse: msg`Ellipse`,
  marker: msg`Point marker`,
  ruler: msg`Ruler`,
  arrow: msg`Arrow`,
  text: msg`Text`,
  comment: msg`Comment`,
  brush: msg`Brush`,
  slides: msg`Slides`,
  sun: msg`Brightness`,
  sliders: msg`Adjustments`,
  gear: msg`Settings`,
  help: msg`Help`,
  share: msg`Share`,
  back: msg`Back`,
  next: msg`Next`,
  popout: msg`Open in a new window`,
  mouse: msg`Mouse`,
  trackpad: msg`Trackpad`,
  spacemouse: msg`3D mouse`,
  gamepad: msg`Gamepad`,
  keyboard: msg`Keyboard`,
  frame: msg`Fit to screen`,
  close: msg`Close`,
  panel: msg`Side panel`,
  home: msg`Home`,
  down: msg`Down`,
  check: msg`Done`,
  warn: msg`Warning`,
  eye: msg`Show`,
  "eye-off": msg`Hide`,
  plus: msg`Add`,
  minus: msg`Remove`,
  pause: msg`Pause`,
  undo: msg`Undo`,
  target: msg`Target`,
  key: msg`Key`,
  lock: msg`Locked`,
  unlock: msg`Unlocked`,
  caret: msg`Expand`,
  pointer: msg`Pointer`,
  pinch: msg`Pinch`,
  pen: msg`Pen`,
  search: msg`Search`,
  flag: msg`Flag`,
  more: msg`More`,
  upload: msg`Upload`,
  file: msg`File`,
  folder: msg`Folder`,
  info: msg`Information`,
  user: msg`Person`,
  board: msg`Board`,
  link: msg`Link`,
  logout: msg`Sign out`,
  download: msg`Download`,
  expand: msg`Full screen`,
  bell: msg`Notifications`,
  clock: msg`Time`,
  calendar: msg`Date`,
  users: msg`People`,
  mail: msg`Email`,
  flask: msg`Study`,
  database: msg`Data`,
  list: msg`List`,
  parfocal: msg`Parfocal`,
  layers: msg`Layers`,
  monitor: msg`Display`,
  shield: msg`Security`,
  "x-circle": msg`Clear`,
  "minus-circle": msg`Remove all`,
} satisfies Record<IconName, MessageDescriptor>;

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
  const { t } = useLingui();
  const { svg, body } = iconSet[name];
  const px = iconSizes[size];
  const spoken = label === true ? t(iconLabels[name]) : label;
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
