import { useGetMe, useListJoinableWorkspaces, useUpdateMe } from "@parfocal/api-client";
import {
  AuthField,
  AuthForm,
  AuthHeading,
  AuthLayout,
  AuthLink,
  AuthStepsSide,
  ChoiceIcon,
  ChoiceOption,
  ChoiceTile,
  WorkspaceLogo,
} from "@parfocal/ui/components/auth";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { Person } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { FilterChip, StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { useGoTo } from "../../shell/router-link.tsx";
import { applyTheme, type ThemeChoice } from "../../shell/theme.ts";
import { okData } from "../placeholder.tsx";
import { slideImage } from "./auth-side.tsx";
import { onboardingScenes, type SetupStep } from "./scenes.ts";

type Role = "res" | "rev" | "both";
type First = "sample" | "create" | "wait";
type Device = "mouse" | "trackpad" | "spacemouse" | "gamepad" | "pen" | "keyboard";

const roles: Record<Role, { icon: IconName; title: string; detail: string; effect: string }> = {
  res: {
    icon: "flask",
    title: "Researcher",
    detail: "Upload slides and AI results, assign reviews, sign off evaluations",
    effect: "Home opens on your projects, with Upload and New review task first.",
  },
  rev: {
    icon: "check",
    title: "Reviewer",
    detail: "Check, fix and comment on AI results, give your opinion",
    effect: "Home opens on My work, with Continue reviewing first.",
  },
  both: {
    icon: "users",
    title: "Both",
    detail: "Run your own evaluations and review for others",
    effect: "Home shows your review tasks and your projects side by side.",
  },
};

const firsts: Record<First, { icon: IconName; title: string; detail: string; note: string }> = {
  sample: {
    icon: "slides",
    title: "Open the sample project",
    detail:
      "4 CAMELYON16 slides with two AI result sets and a review task for you, to try everything safely",
    note: "The sample project stays in your workspace as Sample · sentinel nodes and can be deleted at any time.",
  },
  create: {
    icon: "folder",
    title: "Create a project",
    detail: "Name it, choose de-identified or clinical, pick a class list and an analysis template",
    note: "When setup ends, New project opens with the name, the privacy mode and the class list to fill in.",
  },
  wait: {
    icon: "bell",
    title: "Wait for an invite",
    detail: "Researchers will add you to their projects, and invites show on your home",
    note: "Invites show on your home and in the bell. The sample project is there meanwhile if you want to try things.",
  },
};

const devices: { key: Device; label: string; keys: [string, string][] }[] = [
  {
    key: "mouse",
    label: "Mouse",
    keys: [
      ["Pan", "Drag, or middle-drag"],
      ["Zoom", "Wheel, to the cursor"],
      ["Preset", "Alt+1 to Alt+6"],
      ["Next area", "]"],
    ],
  },
  {
    key: "trackpad",
    label: "Trackpad",
    keys: [
      ["Pan", "Two fingers"],
      ["Zoom", "Pinch"],
      ["Preset", "Alt+1 to Alt+6"],
      ["Whole slide", "Hold Z"],
    ],
  },
  {
    key: "spacemouse",
    label: "SpaceMouse",
    keys: [
      ["Pan", "Tilt the cap"],
      ["Zoom", "Push or pull"],
      ["Preset", "Side buttons"],
      ["Whole slide", "Pull fully"],
    ],
  },
  {
    key: "gamepad",
    label: "Gamepad",
    keys: [
      ["Pan", "Left stick"],
      ["Zoom", "Triggers"],
      ["Preset", "Shoulder buttons"],
      ["Next area", "Start"],
    ],
  },
  {
    key: "pen",
    label: "Tablet and pen",
    keys: [
      ["Pan", "One finger"],
      ["Zoom", "Pinch"],
      ["To 40x", "Double tap"],
      ["Whole slide", "Two-finger double tap"],
    ],
  },
  {
    key: "keyboard",
    label: "Keyboard",
    keys: [
      ["Pan", "Arrows, Shift for 3x"],
      ["Zoom", "+ and -"],
      ["Preset", "Alt+1 to Alt+6"],
      ["Area", "G then a number"],
    ],
  },
];

const specialties = ["Breast", "Lymph nodes", "GI", "Skin", "Hematopathology", "Cytology"];
const titles = ["MUDr.", "Dr.", "Prof. MUDr.", "doc. MUDr.", "Mgr.", "Ing.", "No title"];
const viewers = ["Parfocal", "Sectra", "Aperio", "QuPath", "Philips"];
const stepNames = ["You", "Workspace", "First project", "Viewer", "Done"];
const stepHints = [
  "Role and specialty",
  "Join or create one",
  "Sample or your own",
  "Input device and theme",
  "Getting started",
];

type Choices = {
  role: Role;
  spec: string[];
  title: string;
  ws: string;
  mode: "deid" | "clin";
  first: First;
  device: Device;
  keys: string;
  theme: ThemeChoice;
  newName: string;
};

type Props = { step: SetupStep; change: (step: SetupStep) => void };

export function SetupScreen({ step, change }: Props) {
  const me = okData(useGetMe().data);
  const joinable = useListJoinableWorkspaces().data?.data ?? [];
  const updateMe = useUpdateMe();
  const goTo = useGoTo();
  const index = onboardingScenes.setup.indexOf(step);
  const [reached, setReached] = useState(index);
  const [other, setOther] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [u, setU] = useState<Choices>({
    role: "rev",
    spec: ["Breast", "Lymph nodes"],
    title: "MUDr.",
    ws: "",
    mode: "deid",
    first: "sample",
    device: "mouse",
    keys: "QuPath",
    theme: "dark",
    newName: "",
  });
  const set = (next: Partial<Choices>) => setU({ ...u, ...next });
  const matched = joinable.find((item) => item.matches_email) ?? joinable[0];
  const other_ = joinable.find((item) => item !== matched);
  const ws = u.ws || matched?.id || "";
  const go = (to: number) => {
    const key = onboardingScenes.setup[to];
    if (key === undefined) return;
    setReached(Math.max(reached, to));
    change(key);
  };
  const name = me?.display_name ?? "";
  const firstName = name.split(" ")[0] ?? name;
  const wsName =
    ws === "new"
      ? u.newName || "your new workspace"
      : joinable.find((item) => item.id === ws)?.name;
  const device = devices.find((item) => item.key === u.device) ?? devices[0];
  const recommended: First = u.role === "res" ? "create" : "sample";
  const summary = [
    `${roles[u.role].title}${u.spec.length ? ` · ${u.spec.slice(0, 2).join(", ")}` : ""}`,
    ws === "new" ? "New workspace" : ws === other_?.id ? "Request sent" : "Joined",
    firsts[u.first].title,
    `${device?.label ?? ""} · ${u.theme}`,
    "Getting started",
  ];

  const bodies = [
    <>
      <AuthHeading title="What do you do in Parfocal?">
        This sets your home page and which walkthrough you see first.
      </AuthHeading>
      <div role="radiogroup" aria-label="Role" className="grid grid-cols-3 gap-2.5">
        {(Object.keys(roles) as Role[]).map((key) => (
          <ChoiceTile
            key={key}
            icon={roles[key].icon}
            title={roles[key].title}
            detail={roles[key].detail}
            selected={u.role === key}
            onClick={() => set({ role: key, first: key === "res" ? "create" : "sample" })}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 text-body-sm text-fg-dim">
        <Icon name="home" />
        <span>{roles[u.role].effect}</span>
      </div>
      <AuthField
        label="Specialties"
        aside={<span className="text-fg-faint">used to suggest you for review tasks</span>}
      >
        <div className="flex flex-wrap gap-2">
          {specialties.map((item) => (
            <FilterChip
              key={item}
              pressed={u.spec.includes(item)}
              onPressedChange={(on) =>
                set({ spec: on ? [...u.spec, item] : u.spec.filter((x) => x !== item) })
              }
            >
              {item}
            </FilterChip>
          ))}
          <FilterChip pressed={other} onPressedChange={setOther}>
            + Other
          </FilterChip>
        </div>
        {other ? (
          <Input
            aria-label="Another specialty"
            placeholder="Type a specialty, for example Neuropathology"
            className="mt-2 h-9"
          />
        ) : null}
      </AuthField>
      <div className="grid grid-cols-2 gap-3">
        <AuthField label="Title">
          <Select value={u.title} onValueChange={(value) => set({ title: String(value) })}>
            <SelectTrigger aria-label="Title" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {titles.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </AuthField>
        <AuthField label="Shown to others as">
          <span className="flex h-9 items-center rounded-ctl border border-line bg-chrome-2 px-2.5">
            <Person
              person={{
                ...personOf(me),
                name: `${u.title === "No title" ? "" : `${u.title} `}${name}`,
              }}
              size={20}
            />
          </span>
        </AuthField>
      </div>
    </>,
    <>
      <AuthHeading title="Your workspace">
        Projects, people and models live in a workspace. Its name and logo show next to Parfocal.
      </AuthHeading>
      <div role="radiogroup" aria-label="Workspace" className="grid gap-2">
        {matched ? (
          <ChoiceOption
            lead={<WorkspaceLogo workspace={matched} />}
            title={matched.name}
            detail={`${matched.domain} matches your email · ${matched.members} members · ${matched.projects} projects`}
            selected={ws === matched.id}
            onClick={() => set({ ws: matched.id })}
            end={<StatusTag tone="ok">{ws === matched.id ? "You join at once" : "Join"}</StatusTag>}
          />
        ) : null}
        {other_ ? (
          <ChoiceOption
            lead={<WorkspaceLogo workspace={other_} />}
            title={other_.name}
            detail={
              ws === other_.id
                ? "Someone with admin rights there gets your request and answers by email, usually within a day"
                : "Asks someone with admin rights to let you in"
            }
            selected={ws === other_.id}
            onClick={() => set({ ws: other_.id })}
            end={
              <span className="text-body-sm text-fg-dim">
                {ws === other_.id ? "Request" : "Ask"}
              </span>
            }
          />
        ) : null}
        <ChoiceOption
          lead={
            <span className="grid size-7.5 place-items-center rounded-lg border border-dashed border-line-strong text-fg-faint">
              <Icon name="plus" />
            </span>
          }
          title="Create a new workspace"
          detail="For a lab or a group that is not here yet. You get admin rights to set it up"
          selected={ws === "new"}
          onClick={() => set({ ws: "new" })}
        />
      </div>
      {ws === "new" ? (
        <div className="flex items-start gap-3.5 rounded-xl border border-dashed border-line-strong p-3.5">
          <div className="grid size-16 flex-none place-items-center content-center gap-0.5 rounded-xl border border-dashed border-line-strong text-caption text-fg-faint">
            <Icon name="upload" />
            <small>Logo</small>
          </div>
          <div className="grid flex-1 gap-2.5">
            <AuthField label="Name">
              <Input
                aria-label="Name"
                placeholder="Lab or group name"
                value={u.newName}
                onChange={(event) => set({ newName: event.target.value })}
                className="h-9"
              />
            </AuthField>
            <AuthField label="New projects start as">
              <SegmentedControl
                aria-label="New projects start as"
                value={u.mode}
                onValueChange={(value) => set({ mode: value as Choices["mode"] })}
                options={[
                  { value: "deid", label: "De-identified" },
                  { value: "clin", label: "Clinical" },
                ]}
                className="w-75"
                fill
              />
              <span className="text-caption text-fg-dim">
                {u.mode === "deid"
                  ? "No patient fields, names are stripped on upload."
                  : "Patient fields allowed, every view of them is logged."}
              </span>
            </AuthField>
            <span className="text-caption text-fg-dim">
              Creating a workspace gives you admin rights on it as a researcher.
            </span>
          </div>
        </div>
      ) : null}
      {ws === other_?.id ? (
        <Banner inline tone="info">
          While you wait, the sample project is yours to try things in.
        </Banner>
      ) : null}
    </>,
    <>
      <AuthHeading title="Start with a project">
        A project holds slides, AI results and review tasks. Cases and patient details are optional.
      </AuthHeading>
      <div role="radiogroup" aria-label="First project" className="grid grid-cols-3 gap-2.5">
        {(Object.keys(firsts) as First[]).map((key) => (
          <ChoiceTile
            key={key}
            tall
            icon={firsts[key].icon}
            title={firsts[key].title}
            detail={firsts[key].detail}
            selected={u.first === key}
            onClick={() => set({ first: key })}
            badge={
              key === recommended ? <StatusTag tone="accent">Recommended</StatusTag> : undefined
            }
          />
        ))}
      </div>
      <Banner inline tone="info">
        {firsts[u.first].note}
      </Banner>
    </>,
    <>
      <AuthHeading title="How do you move around a slide?">
        Sets the wheel, drag and key defaults. Change any of it later in Settings.
      </AuthHeading>
      <div role="radiogroup" aria-label="Input device" className="grid grid-cols-6 gap-2">
        {devices.map((item) => (
          <ChoiceIcon
            key={item.key}
            icon={item.key}
            selected={u.device === item.key}
            onClick={() => set({ device: item.key })}
          >
            {item.label}
          </ChoiceIcon>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {device?.keys.map(([what, how]) => (
          <span key={what} className="grid gap-0.5 rounded-ctl bg-chrome-2 px-2.5 py-2">
            <small className="text-caption text-fg-faint">{what}</small>
            <b className="text-body-sm">{how}</b>
          </span>
        ))}
      </div>
      <AuthField label="Viewer you are used to">
        <SegmentedControl
          aria-label="Viewer you are used to"
          value={u.keys}
          onValueChange={(value) => set({ keys: String(value) })}
          options={viewers.map((item) => ({ value: item, label: item }))}
          className="w-140"
          fill
        />
        <span className="text-caption text-fg-dim">
          {u.keys === "Parfocal"
            ? "Parfocal keys, shown on every button."
            : `Keys follow ${u.keys} where they can. Every key can be changed later.`}
        </span>
      </AuthField>
      <AuthField label="Theme">
        <SegmentedControl
          aria-label="Theme"
          value={u.theme}
          onValueChange={(value) => {
            const theme = value as ThemeChoice;
            applyTheme(theme);
            set({ theme });
          }}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
          className="w-75"
          fill
        />
      </AuthField>
      <button
        type="button"
        onClick={() => setZoom(!zoom)}
        title="Click to zoom in and out"
        className={cn(
          "relative h-42.5 cursor-zoom-in rounded-xl border-0 bg-center p-0 transition-[background-size] duration-300",
          zoom ? "bg-[length:400%] cursor-zoom-out" : "bg-cover",
        )}
        style={{ backgroundImage: `url(${slideImage})` }}
      >
        <span className="absolute top-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-body-sm text-white">
          {zoom
            ? "Zoomed to 10×. Click again to zoom out."
            : `Try it. Click to zoom, as with ${device?.keys[1]?.[1].toLowerCase() ?? "the wheel"}.`}
        </span>
      </button>
    </>,
    <DoneStep
      key="done"
      firstName={firstName}
      role={u.role}
      first={u.first}
      ws={ws === "new" ? "new" : ws === other_?.id ? "asked" : "joined"}
      wsName={wsName ?? ""}
    />,
  ];

  const last = index === stepNames.length - 1;
  const nextLabel =
    index === 1 && ws === other_?.id
      ? "Send the request and continue"
      : index === 1 && ws === "new"
        ? "Create it and continue"
        : `Next: ${stepNames[index + 1] ?? ""}`;
  const finish = () =>
    void goTo(
      u.first === "sample"
        ? "/?scene=new"
        : u.first === "create"
          ? destinations.newProject()
          : destinations.home(),
    );
  const finishLabel =
    u.first === "create"
      ? "Create my first project"
      : u.first === "wait"
        ? "Go to my home"
        : "Open the sample project";
  return (
    <AuthLayout
      side={
        <AuthStepsSide
          workspace={{
            name: matched?.name ?? "",
            logo: matched?.logo ?? "",
            colour: matched?.colour ?? "transparent",
          }}
          steps={stepNames.map((stepName, at) => ({
            name: stepName,
            sub: at < index ? (summary[at] ?? "") : (stepHints[at] ?? ""),
          }))}
          current={index}
          reached={reached}
          onStepSelect={go}
          note="Everything here can be changed later in Settings. Skip any step."
        />
      }
    >
      <AuthForm width="wizard">
        {bodies[index]}
        <div className="mt-1.5 flex items-center gap-2.5 border-t border-line pt-4.5">
          {last ? null : <AuthLink onClick={() => go(index + 1)}>Skip this step</AuthLink>}
          <span className="flex-1" />
          {index > 0 ? <Button onClick={() => go(index - 1)}>Back</Button> : null}
          {last ? (
            <Button variant="primary" size="lg" onClick={finish}>
              {finishLabel}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                if (index === 0) {
                  updateMe.mutate({ data: { title: u.title === "No title" ? null : u.title } });
                }
                go(index + 1);
              }}
            >
              {nextLabel}
            </Button>
          )}
        </div>
      </AuthForm>
    </AuthLayout>
  );
}

function DoneStep({
  firstName,
  role,
  first,
  ws,
  wsName,
}: {
  firstName: string;
  role: Role;
  first: First;
  ws: "joined" | "asked" | "new";
  wsName: string;
}) {
  const workspaceRow: [IconName, string, boolean, string?] =
    ws === "joined"
      ? ["check", `Joined ${wsName}`, true]
      : ws === "asked"
        ? ["mail", `Asked to join ${wsName}`, false, "waiting for its admin"]
        : ["check", `Created ${wsName}`, true];
  const projectRow: [IconName, string, boolean, string?] =
    first === "sample"
      ? ["check", "Sample project ready: 4 slides, 2 result sets", true]
      : first === "create"
        ? ["folder", "Create your first project", false, "next, after this"]
        : ["bell", "Wait for an invite from a researcher", false, "on your home"];
  const todo: [IconName, string][] =
    role === "res"
      ? [
          ["upload", "Upload slides and their AI results"],
          ["users", "Hand slides to reviewers as a review task"],
          ["file", "Read an evaluation report"],
        ]
      : role === "rev"
        ? [
            ["flag", "Review your first slide in RT-S1"],
            ["comment", "Leave a comment on an object ID"],
            ["file", "Submit your opinion form"],
          ]
        : [
            ["flag", "Review your first slide in RT-S1"],
            ["upload", "Upload slides and their AI results"],
            ["users", "Hand slides to reviewers as a review task"],
          ];
  const rows: [IconName, string, boolean, string?][] = [
    ["check", "Account and email confirmed", true],
    workspaceRow,
    projectRow,
    ...todo.map(([icon, text]): [IconName, string, boolean, string] => [
      icon,
      text,
      false,
      "on your home",
    ]),
  ];
  return (
    <>
      <AuthHeading title={`You're set, ${firstName}`}>
        Your home keeps a short checklist until each part has been tried once. {roles[role].effect}
      </AuthHeading>
      <ul aria-label="Getting started" className="m-0 grid list-none gap-3 p-0">
        {rows.map(([icon, text, ok, note]) => (
          <li
            key={text}
            className={cn("flex items-center gap-2.5 text-body-sm", ok ? "text-fg" : "text-fg-dim")}
          >
            <Icon name={ok ? "check" : icon} className={ok ? "text-ok" : undefined} />
            <span className="flex-1">{text}</span>
            {ok ? null : <small className="text-caption text-fg-faint">{note}</small>}
          </li>
        ))}
      </ul>
    </>
  );
}
