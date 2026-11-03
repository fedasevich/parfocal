import { ApiError } from "@parfocal/api-client";
import { CodeBoxes } from "@parfocal/ui/components/auth";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { type KeyboardEvent, useEffect, useState } from "react";
import { codeDigits, codeLength } from "./sign-in-rules.ts";

export const handled = { mutation: { onError: () => undefined } };

export const onEnter = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  action();
};

export const problemText = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.problem?.title ? error.problem.title : fallback;

export function PasswordInput({
  label,
  id,
  value,
  onChange,
  onSubmit,
  fresh = false,
}: {
  fresh?: boolean;
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative flex items-center">
      <Input
        id={id}
        aria-label={label}
        type={shown ? "text" : "password"}
        value={value}
        autoComplete={`${fresh ? "new" : "current"}-password`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onSubmit ? onEnter(onSubmit) : undefined}
        className="h-9 pr-9 font-mono"
      />
      <button
        type="button"
        aria-label={shown ? "Hide what you typed" : "Show what you typed"}
        onClick={() => setShown(!shown)}
        className="absolute right-2 cursor-pointer border-0 bg-transparent p-0 text-fg-faint"
      >
        <Icon name={shown ? "eye-off" : "eye"} />
      </button>
    </span>
  );
}

export function CodeInput({
  label,
  value,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="relative">
      <CodeBoxes digits={value} aria-hidden="true" />
      <input
        aria-label={label}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={codeLength}
        value={value}
        onChange={(event) => onChange(codeDigits(event.target.value))}
        onKeyDown={onEnter(() => value.length === codeLength && onSubmit())}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}

export function useCountdown(initial: number): [number, (seconds: number) => void] {
  const [secondsLeft, setSecondsLeft] = useState(initial);
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);
  return [secondsLeft, setSecondsLeft];
}
