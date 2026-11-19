import { useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";

export function WholeSlideButton({
  onClick,
  pressed,
  title,
  testId,
}: {
  onClick: () => void;
  pressed?: boolean;
  title?: string;
  testId?: string;
}) {
  const { t } = useLingui();
  return (
    <Button
      size="lg"
      variant={pressed ? "selected" : "secondary"}
      className={pressed ? undefined : "bg-chrome shadow-pop"}
      data-testid={testId}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
    >
      <Icon name="expand" />
      {t`Whole slide`}
    </Button>
  );
}
