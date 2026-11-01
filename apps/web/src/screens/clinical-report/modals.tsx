import { InlineError } from "@parfocal/ui/components/banner";
import { Input } from "@parfocal/ui/components/input";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";
import { Textarea } from "@parfocal/ui/components/textarea";
import { TokenField } from "@parfocal/ui/components/token-field";
import { useEffect, useRef, useState } from "react";
import { FieldNote } from "../new-task/parts.tsx";
import { type Dep, fmtMm, parseNumber, type ReportData } from "./model.ts";
import { fieldId, KvList, linkButton } from "./parts.tsx";

export const closeOn = (onClose: () => void) => (open: boolean) => {
  if (!open) onClose();
};

type DepositDraft = {
  source: "object" | "hand";
  object: string | null;
  size: string;
  unit: "mm" | "um" | null;
  slide: string | null;
  note: string;
};

export function depositErrors(draft: DepositDraft) {
  const errors: Record<string, string> = {};
  if (draft.source === "object") {
    if (!draft.object) errors["obj"] = "Pick an object, or measure the deposit by hand.";
    return errors;
  }
  const number = parseNumber(draft.size);
  const mm = number === null ? null : draft.unit === "um" ? number / 1000 : number;
  if (!draft.size.trim()) errors["mm"] = "Enter the size.";
  else if (number === null || number <= 0) errors["mm"] = "Use a number above 0, for example 1.5.";
  else if (draft.unit && mm !== null && mm > 100) errors["mm"] = "Use a size up to 100 mm.";
  else if (draft.unit && mm !== null && mm < 0.01) errors["mm"] = "Use a size of at least 10 µm.";
  if (!draft.unit) errors["unit"] = "Pick mm or µm.";
  if (!draft.slide) errors["slide"] = "Pick the slide you measured on.";
  return errors;
}

export function DepositModal({
  data,
  caseLabel,
  deposits,
  hand,
  onClose,
  onAdd,
}: {
  data: ReportData;
  caseLabel: string;
  deposits: Dep[];
  hand: boolean;
  onClose: () => void;
  onAdd: (deposit: Omit<Dep, "id">) => void;
}) {
  const [draft, setDraft] = useState<DepositDraft>(
    hand
      ? { source: "hand", object: null, size: "0", unit: null, slide: null, note: "" }
      : { source: "object", object: null, size: "", unit: null, slide: null, note: "" },
  );
  const [tried, setTried] = useState(hand);
  const errors = depositErrors(draft);
  const shown = tried ? errors : {};
  const objects = data.objects.map((object) => {
    const slide = data.slides.find((candidate) => candidate.key === object.slide);
    const used = deposits.some(
      (deposit) => deposit.slide === object.slide && deposit.objectId === object.object_id,
    );
    return {
      key: `${object.slide}:${object.object_id}`,
      object,
      item: {
        id: `${object.slide}:${object.object_id}`,
        name: `${object.object_id} on ${slide?.label ?? object.slide}`,
        sub: `Node ${slide?.node ?? 1} · ${fmtMm(object.size_mm)} mm, ${object.measured_by === "you" ? "measured by you" : "AI outline"}`,
        find: `${object.object_id} ${object.slide} ${slide?.label ?? ""} ${slide?.short ?? ""}`,
        ...(used
          ? { dim: "Already listed" }
          : object.state === "disagree"
            ? { dim: "Marked not tumor by you" }
            : {}),
      },
    };
  });
  const picked = objects.find((entry) => entry.key === draft.object)?.object;
  const set = (patch: Partial<DepositDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0] ?? "";
      document.getElementById(fieldId(`dep-${first}`))?.focus();
      return;
    }
    if (draft.source === "object" && picked) {
      onAdd({
        slide: picked.slide,
        objectId: picked.object_id,
        size: String(+picked.size_mm.toFixed(picked.size_mm < 1 ? 2 : 1)),
        note: draft.note.trim(),
      });
      return;
    }
    const number = parseNumber(draft.size) ?? 0;
    const mm = draft.unit === "um" ? number / 1000 : number;
    onAdd({
      slide: draft.slide ?? "",
      objectId: null,
      size: String(+mm.toFixed(mm < 1 ? 2 : 1)),
      note: draft.note.trim(),
    });
  };
  return (
    <SmallModal
      open
      onOpenChange={closeOn(onClose)}
      width={560}
      title="Add a deposit"
      subtitle={
        <>
          <span className="font-mono">{caseLabel}</span> · {deposits.length} listed. The largest
          sets the category.
        </>
      }
      hint={
        draft.source === "object"
          ? "The size comes from the object."
          : "Sizes in µm are kept in mm."
      }
      primaryLabel="Add the deposit"
      onPrimary={submit}
    >
      <div className="grid gap-1.5">
        <span id="dep-source-label" className="text-body-sm font-semibold">
          Where it comes from
        </span>
        <SegmentedControl
          aria-labelledby="dep-source-label"
          value={draft.source}
          onValueChange={(next) => set({ source: next as DepositDraft["source"] })}
          options={[
            { value: "object", label: "An object on a slide" },
            { value: "hand", label: "Measured by hand" },
          ]}
        />
      </div>
      {draft.source === "object" ? (
        <div className="grid gap-1.5">
          <span id="dep-obj-label" className="text-body-sm font-semibold">
            Object
          </span>
          <TokenField
            id={fieldId("dep-obj")}
            aria-labelledby="dep-obj-label"
            label="Object"
            single
            defaultOpen={!hand}
            placeholder="Type an object ID or a slide"
            items={objects.map((entry) => entry.item)}
            picked={draft.object ? [draft.object] : []}
            invalid={Boolean(shown["obj"])}
            onPickedChange={(ids) => set({ object: ids[0] ?? null })}
          />
          <FieldNote
            error={shown["obj"]}
            help={
              picked
                ? `${fmtMm(picked.size_mm)} mm, ${picked.measured_by === "you" ? "measured by you" : "from the AI outline"}. You can change the size in the list.`
                : "Type an object ID or a slide, for example T4 or A2."
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[auto_1fr] items-start gap-4">
            <div className="grid gap-1.5">
              <label htmlFor={fieldId("dep-mm")} className="text-body-sm font-semibold">
                Size
              </label>
              <Input
                id={fieldId("dep-mm")}
                inputMode="decimal"
                className="w-24 font-mono"
                aria-invalid={shown["mm"] ? true : undefined}
                value={draft.size}
                onChange={(event) => set({ size: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <span id="dep-unit-label" className="text-body-sm font-semibold">
                Unit
              </span>
              <SegmentedControl
                id={fieldId("dep-unit")}
                aria-labelledby="dep-unit-label"
                value={draft.unit ?? ""}
                onValueChange={(next) => set({ unit: next as DepositDraft["unit"] })}
                options={[
                  { value: "mm", label: "mm" },
                  { value: "um", label: "µm" },
                ]}
              />
            </div>
          </div>
          {shown["mm"] || shown["unit"] ? (
            <div className="-mt-3 grid gap-1">
              <FieldNote error={shown["mm"]} />
              <FieldNote error={shown["unit"]} />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <span id="dep-slide-label" className="text-body-sm font-semibold">
              Slide
            </span>
            <Select value={draft.slide} onValueChange={(next) => set({ slide: next })}>
              <SelectTrigger
                id={fieldId("dep-slide")}
                aria-labelledby="dep-slide-label"
                aria-invalid={shown["slide"] ? true : undefined}
                className="w-64"
              >
                <SelectValue>
                  {data.slides.find((slide) => slide.key === draft.slide)?.label ?? "Pick a slide"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {data.slides.map((slide) => (
                  <SelectItem key={slide.key} value={slide.key}>
                    {slide.label} · Node {slide.node}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldNote error={shown["slide"]} />
          </div>
        </>
      )}
      <div className="grid gap-1.5">
        <label htmlFor={fieldId("dep-note")} className="text-body-sm font-semibold">
          Note <span className="font-normal text-fg-dim">optional</span>
        </label>
        <Input
          id={fieldId("dep-note")}
          maxLength={120}
          placeholder="For example, subcapsular sinus"
          value={draft.note}
          onChange={(event) => set({ note: event.target.value })}
        />
        <FieldNote count={`${draft.note.length} / 120`} />
      </div>
    </SmallModal>
  );
}

const signLabel = { sso: "Sign with Vltava SSO", typed: "Sign with password" };

export function useSignature({
  failed,
  email,
  onSign,
}: {
  failed: boolean;
  email: string;
  onSign: (method: "sso" | "password", done: (ok: boolean) => void) => void;
}) {
  const [state, setState] = useState<"idle" | "busy" | "fail">(failed ? "fail" : "idle");
  const [password, setPassword] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const withPassword = password !== null;
  const passwordError = tried && withPassword && !password ? "Enter your password." : undefined;
  const run = () => {
    if (withPassword && !password) {
      setTried(true);
      return;
    }
    setState("busy");
    timer.current = window.setTimeout(() => {
      onSign(withPassword ? "password" : "sso", (ok) => setState(ok ? "idle" : "fail"));
    }, 800);
  };
  const busy = state === "busy";
  const zone = busy ? null : withPassword ? (
    <SmallModalZone title="Sign with your password">
      <div className="grid gap-1.5">
        <label htmlFor={fieldId("pass")} className="text-body-sm font-semibold">
          Password for {email}
        </label>
        <Input
          id={fieldId("pass")}
          type="password"
          autoFocus
          aria-invalid={passwordError ? true : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <FieldNote error={passwordError} help="Your Vltava password" />
      </div>
    </SmallModalZone>
  ) : state === "fail" ? (
    <InlineError
      actions={
        <>
          <button type="button" className={linkButton} onClick={run}>
            Try again
          </button>
          <button
            type="button"
            className={linkButton}
            onClick={() => {
              setState("idle");
              setPassword("");
            }}
          >
            Use my password instead
          </button>
        </>
      }
    >
      Vltava single sign-on did not answer. Nothing was signed.
    </InlineError>
  ) : null;
  return {
    busy,
    run,
    zone,
    label: signLabel[withPassword ? "typed" : "sso"],
    busyHint: withPassword ? "Checking your password…" : "Waiting for single sign-on…",
  };
}

export function SignModal({
  title,
  subtitle,
  rows,
  email,
  failed,
  pending,
  onClose,
  onSign,
}: {
  title: string;
  subtitle: string;
  rows: { icon: "user" | "mail" | "file"; label: string; value: string }[];
  email: string;
  failed: boolean;
  pending: boolean;
  onClose: () => void;
  onSign: (method: "sso" | "password", done: (ok: boolean) => void) => void;
}) {
  const signature = useSignature({ failed, email, onSign });
  const busy = signature.busy || pending;
  return (
    <SmallModal
      open
      onOpenChange={closeOn(onClose)}
      title={title}
      subtitle={subtitle}
      hint={busy ? signature.busyHint : "Signing locks this version."}
      primaryLabel={signature.label}
      primaryBusy={busy}
      onPrimary={signature.run}
    >
      <SmallModalZone>
        <KvList rows={rows} />
      </SmallModalZone>
      {busy ? null : signature.zone}
    </SmallModal>
  );
}

export function ReasonModal({
  title,
  subtitle,
  what,
  whatLabel,
  told,
  label,
  placeholder,
  help,
  hint,
  primary,
  tooShort,
  empty,
  tried: triedFirst = false,
  onClose,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  what: string;
  whatLabel: string;
  told?: string;
  label: string;
  placeholder: string;
  help: string;
  hint: string;
  primary: string;
  tooShort: string;
  empty?: string;
  tried?: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [tried, setTried] = useState(triedFirst);
  const trimmed = text.trim();
  const problem = !trimmed && empty ? empty : trimmed.length < 10 ? tooShort : undefined;
  const error = tried ? problem : undefined;
  return (
    <SmallModal
      open
      onOpenChange={closeOn(onClose)}
      title={title}
      subtitle={subtitle}
      hint={hint}
      primaryLabel={primary}
      onPrimary={() => {
        setTried(true);
        if (problem) {
          document.getElementById(fieldId("reason"))?.focus();
          return;
        }
        onSubmit(trimmed);
      }}
    >
      <div className="grid gap-1.5">
        <span className="text-body-sm font-semibold">{whatLabel}</span>
        <p className="m-0 text-body-sm text-fg">{what}</p>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={fieldId("reason")} className="text-body-sm font-semibold">
          {label}
        </label>
        <Textarea
          id={fieldId("reason")}
          rows={4}
          maxLength={300}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <FieldNote error={error} help={help} count={`${text.length} / 300`} />
      </div>
      {told ? (
        <div className="grid gap-1.5">
          <span className="text-body-sm font-semibold">Who is told</span>
          <p className="m-0 text-body-sm text-fg">{told}</p>
        </div>
      ) : null}
    </SmallModal>
  );
}
