import { type IconName, iconNames, iconSet } from "@parfocal/ui/components/icon-set";
import { cn } from "cn";
import type { SVGProps } from "react";

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
  label?: string;
};

function Icon({ name, size = "sm", label, className, ...props }: IconProps) {
  const { svg, body } = iconSet[name];
  const px = iconSizes[size];
  return (
    <svg
      data-slot="icon"
      data-icon-name={name}
      viewBox="0 0 24 24"
      width={px}
      height={px}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0", sizeClasses[size], className)}
      {...svg}
      {...props}
    >
      {body}
    </svg>
  );
}

export { Icon, type IconName, type IconProps, type IconSize, iconNames, iconSizes };
