import { Button, type ButtonProps } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";

const iconButtonSizes = { md: "icon", sm: "icon-sm", xs: "icon-xs" } as const;

type IconButtonProps = Omit<ButtonProps, "children" | "size" | "aria-label"> & {
  icon: IconName;
  label: string;
  size?: keyof typeof iconButtonSizes;
};

function IconButton({ icon, label, size = "md", variant = "ghost", ...props }: IconButtonProps) {
  return (
    <Button
      data-icon-button=""
      variant={variant}
      size={iconButtonSizes[size]}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} />
    </Button>
  );
}

export { IconButton, type IconButtonProps, iconButtonSizes };
