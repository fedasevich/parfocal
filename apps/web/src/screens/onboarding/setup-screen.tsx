import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  getGetMySettingLayersQueryKey,
  useAskToJoinWorkspace,
  useCreateMyWorkspace,
  useCreateSampleProject,
  useGetMe,
  useJoinWorkspace,
  useListJoinableWorkspaces,
  useSetMySettingLayers,
  useUpdateMe,
} from "@parfocal/api-client";
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
import { lazyText } from "@parfocal/ui/lib/lazy-text";
import { cn } from "@parfocal/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { writeDeviceSetting } from "../../shell/device-settings.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { chooseTheme, readTheme, type ThemeChoice } from "../../shell/theme.ts";
import type { SetupRole as Role } from "../home/home-layout.ts";
import { okData } from "../placeholder.tsx";
import { onboardingScenes, type SetupStep } from "./scenes.ts";
import {
  creatorNote,
  type SetupDevice as Device,
  type SetupFirst as First,
  firstDestination,
  logoMarkOf,
  newWorkspaceColour,
  personalValuesOf,
  recommendedFirst,
  type SetupMode,
  specialtiesOf,
  wheelModeOf,
  workspaceMoveOf,
} from "./setup-rules.ts";

const roles: Record<Role, { icon: IconName; title: string; detail: string; effect: string }> =
  lazyText(() => ({
    res: {
      icon: "flask",
      title: t`Researcher`,
      detail: t`Upload slides and AI results, assign reviews, sign off evaluations`,
      effect: t`Home opens on your projects, with Upload and New review task first.`,
    },
    rev: {
      icon: "check",
      title: t`Reviewer`,
      detail: t`Check, fix and comment on AI results, give your opinion`,
      effect: t`Home opens on My work, with Continue reviewing first.`,
    },
    both: {
      icon: "users",
      title: t`Both`,
      detail: t`Run your own evaluations and review for others`,
      effect: t`Home shows your review tasks and your projects side by side.`,
    },
  }));

const firsts: Record<First, { icon: IconName; title: string; detail: string; note: string }> =
  lazyText(() => ({
    sample: {
      icon: "slides",
      title: t`Open the sample project`,
      detail: t`4 CAMELYON16 slides with two AI result sets and a review task for you, to try everything safely`,
      note: t`The sample project stays in your workspace as Sample · sentinel nodes and can be deleted at any time.`,
    },
    create: {
      icon: "folder",
      title: t`Create a project`,
      detail: t`Name it, choose de-identified or clinical, pick a class list and an analysis template`,
      note: t`When setup ends, New project opens with the name, the privacy mode and the class list to fill in.`,
    },
    wait: {
      icon: "bell",
      title: t`Wait for an invite`,
      detail: t`Researchers will add you to their projects, and invites show on your home`,
      note: t`Invites show on your home and in the bell. The sample project is there meanwhile if you want to try things.`,
    },
  }));

const devices: { key: Device; label: string; keys: [string, string][] }[] = lazyText(() => [
  {
    key: "mouse",
    label: t`Mouse`,
    keys: [
      ["Pan", t`Drag, or middle-drag`],
      [t`Zoom`, t`Wheel, to the cursor`],
      [t`Preset`, t`Alt+1 to Alt+6`],
      [t`Next area`, "]"],
    ],
  },
  {
    key: "trackpad",
    label: t`Trackpad`,
    keys: [
      ["Pan", t`Two fingers`],
      [t`Zoom`, t`Pinch`],
      [t`Preset`, t`Alt+1 to Alt+6`],
      [t`Whole slide`, "Hold Z"],
    ],
  },
  {
    key: "spacemouse",
    label: "SpaceMouse",
    keys: [
      ["Pan", t`Tilt the cap`],
      [t`Zoom`, t`Push or pull`],
      [t`Preset`, t`Side buttons`],
      [t`Whole slide`, t`Pull fully`],
    ],
  },
  {
    key: "gamepad",
    label: t`Gamepad`,
    keys: [
      ["Pan", t`Left stick`],
      [t`Zoom`, t`Triggers`],
      [t`Preset`, t`Shoulder buttons`],
      [t`Next area`, t`Start`],
    ],
  },
  {
    key: "pen",
    label: t`Tablet and pen`,
    keys: [
      ["Pan", t`One finger`],
      [t`Zoom`, t`Pinch`],
      ["To 40x", t`Double tap`],
      [t`Whole slide`, t`Two-finger double tap`],
    ],
  },
  {
    key: "keyboard",
    label: t`Keyboard`,
    keys: [
      ["Pan", t`Arrows, Shift for 3x`],
      [t`Zoom`, t`+ and -`],
      [t`Preset`, t`Alt+1 to Alt+6`],
      [t`Area`, t`G then a number`],
    ],
  },
]);

const specialties = lazyText(() => [
  t`Breast`,
  t`Lymph nodes`,
  "GI",
  t`Skin`,
  t`Hematopathology`,
  t`Cytology`,
]);
const titles = lazyText(() => [
  "MUDr.",
  "Dr.",
  "Prof. MUDr.",
  "doc. MUDr.",
  "Mgr.",
  "Ing.",
  t`No title`,
]);
const viewers = lazyText(() => [t`Parfocal`, t`Sectra`, t`Aperio`, "QuPath", t`Philips`]);
const stepNames = lazyText(() => ["You", t`Workspace`, t`First project`, t`Viewer`, t`Done`]);
const stepHints = lazyText(() => [
  t`Role and specialty`,
  t`Join or create one`,
  t`Sample or your own`,
  t`Input device and theme`,
  t`Getting started`,
]);

type Choices = {
  role: Role;
  spec: string[];
  otherSpec: string;
  title: string;
  ws: string;
  mode: SetupMode;
  first: First;
  device: Device;
  keys: string;
  theme: ThemeChoice;
  newName: string;
};

type Props = { step: SetupStep; change: (step: SetupStep) => void };

export function SetupScreen({ step, change }: Props) {
  const { t } = useLingui();

  const me = okData(useGetMe().data);
  const joinable = okData(useListJoinableWorkspaces().data) ?? [];
  const updateMe = useUpdateMe();
  const queryClient = useQueryClient();
  const saveLayers = useSetMySettingLayers({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const joinWorkspace = useJoinWorkspace();
  const askToJoin = useAskToJoinWorkspace();
  const createWorkspace = useCreateMyWorkspace();
  const createSample = useCreateSampleProject();
  const router = useRouter();
  const [failed, setFailed] = useState("");
  const [moved, setMoved] = useState("");
  const index = onboardingScenes.setup.indexOf(step);
  const [reached, setReached] = useState(index);
  const [other, setOther] = useState(false);
  const [u, setU] = useState<Choices>({
    role: "rev",
    spec: [t`Breast`, t`Lymph nodes`],
    otherSpec: "",
    title: "MUDr.",
    ws: "",
    mode: "deid",
    first: "sample",
    device: "mouse",
    keys: "QuPath",
    theme: readTheme(),
    newName: "",
  });
  const set = (next: Partial<Choices>) => setU({ ...u, ...next });
  const brand = (item: (typeof joinable)[number]) => ({
    name: item.name,
    logo: item.logo,
    colour: item.logo_colour,
  });
  const matched = joinable.find((item) => item.how === "join");
  const picked = joinable.find((item) => item.id === (u.ws || matched?.id));
  const asking = picked?.how === "ask";
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
      ? u.newName || t`your new workspace`
      : joinable.find((item) => item.id === ws)?.name;
  const device = devices.find((item) => item.key === u.device) ?? devices[0];
  const recommended = recommendedFirst(u.role);
  const summary = [
    `${roles[u.role].title}${u.spec.length ? ` · ${u.spec.slice(0, 2).join(", ")}` : ""}`,
    ws === "new" ? t`New workspace` : asking ? t`Request sent` : t`Joined`,
    firsts[u.first].title,
    `${device?.label ?? ""} · ${u.theme}`,
    t`Getting started`,
  ];

  const bodies = [
    <>
      <AuthHeading title={t`What do you do in Parfocal?`}>
        <Trans>This sets your home page and which walkthrough you see first.</Trans>
      </AuthHeading>
      <div role="radiogroup" aria-label={t`Role`} className="grid grid-cols-3 gap-2.5">
        {(Object.keys(roles) as Role[]).map((key) => (
          <ChoiceTile
            key={key}
            icon={roles[key].icon}
            title={roles[key].title}
            detail={roles[key].detail}
            selected={u.role === key}
            onClick={() => set({ role: key, first: recommendedFirst(key) })}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 text-body-sm text-fg-dim">
        <Icon name="home" />
        <span>{roles[u.role].effect}</span>
      </div>
      <AuthField
        label={t`Specialties`}
        aside={
          <span className="text-fg-faint">
            <Trans>used to suggest you for review tasks</Trans>
          </span>
        }
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
            <Trans>+ Other</Trans>
          </FilterChip>
        </div>
        {other ? (
          <Input
            aria-label={t`Another specialty`}
            placeholder={t`Type a specialty, for example Neuropathology`}
            value={u.otherSpec}
            onChange={(event) => set({ otherSpec: event.target.value })}
            className="mt-2 h-9"
          />
        ) : null}
      </AuthField>
      <div className="grid grid-cols-2 gap-3">
        <AuthField label={t`Title`}>
          <Select value={u.title} onValueChange={(value) => set({ title: String(value) })}>
            <SelectTrigger aria-label={t`Title`} className="h-9 w-full">
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
        <AuthField label={t`Shown to others as`}>
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
      <AuthHeading title={t`Your workspace`}>
        <Trans>
          Projects, people and models live in a workspace. Its name and logo show next to Parfocal.
        </Trans>
      </AuthHeading>
      <div role="radiogroup" aria-label={t`Workspace`} className="grid gap-2">
        {joinable.map((item) =>
          item.how === "join" ? (
            <ChoiceOption
              key={item.id}
              lead={<WorkspaceLogo workspace={brand(item)} />}
              title={item.name}
              detail={t`${item.domain} matches your email · ${item.members} members · ${item.projects} projects`}
              selected={ws === item.id}
              onClick={() => set({ ws: item.id })}
              end={
                <StatusTag tone="ok">{ws === item.id ? t`You join at once` : t`Join`}</StatusTag>
              }
            />
          ) : (
            <ChoiceOption
              key={item.id}
              lead={<WorkspaceLogo workspace={brand(item)} />}
              title={item.name}
              detail={
                ws === item.id || item.asked
                  ? t`Someone with admin rights there gets your request and answers by email, usually within a day`
                  : t`Asks someone with admin rights to let you in`
              }
              selected={ws === item.id}
              onClick={() => set({ ws: item.id })}
              end={
                <span className="text-body-sm text-fg-dim">
                  {item.asked ? t`Asked` : ws === item.id ? t`Request` : t`Ask`}
                </span>
              }
            />
          ),
        )}
        <ChoiceOption
          lead={
            <span className="grid size-7.5 place-items-center rounded-lg border border-dashed border-line-strong text-fg-faint">
              <Icon name="plus" />
            </span>
          }
          title={t`Create a new workspace`}
          detail={t`For a lab or a group that is not here yet. You get admin rights to set it up`}
          selected={ws === "new"}
          onClick={() => set({ ws: "new" })}
        />
      </div>
      {ws === "new" ? (
        <div className="flex items-start gap-3.5 rounded-xl border border-dashed border-line-strong p-3.5">
          <div className="grid size-16 flex-none place-items-center content-center gap-0.5 rounded-xl border border-dashed border-line-strong text-caption text-fg-faint">
            {logoMarkOf(u.newName) === "" ? (
              <>
                <Icon name="upload" />
                <small>
                  <Trans>Logo</Trans>
                </small>
              </>
            ) : (
              <WorkspaceLogo
                workspace={{
                  name: u.newName,
                  logo: logoMarkOf(u.newName),
                  colour: newWorkspaceColour,
                }}
                size={40}
              />
            )}
          </div>
          <div className="grid flex-1 gap-2.5">
            <AuthField label={t`Name`}>
              <Input
                aria-label={t`Name`}
                placeholder={t`Lab or group name`}
                value={u.newName}
                onChange={(event) => set({ newName: event.target.value })}
                className="h-9"
              />
            </AuthField>
            <AuthField label={t`New projects start as`}>
              <SegmentedControl
                aria-label={t`New projects start as`}
                value={u.mode}
                onValueChange={(value) => set({ mode: value as SetupMode })}
                options={[
                  { value: "deid", label: "De-identified" },
                  { value: "clin", label: t`Clinical` },
                ]}
                className="w-75"
                fill
              />
              <span className="text-caption text-fg-dim">
                {u.mode === "deid"
                  ? t`No patient fields, names are stripped on upload.`
                  : t`Patient fields allowed, every view of them is logged.`}
              </span>
            </AuthField>
            <span className="text-caption text-fg-dim">{creatorNote}</span>
          </div>
        </div>
      ) : null}
      {asking ? (
        <Banner inline tone="info">
          <Trans>While you wait, the sample project is yours to try things in.</Trans>
        </Banner>
      ) : null}
    </>,
    <>
      <AuthHeading title={t`Start with a project`}>
        <Trans>
          A project holds slides, AI results and review tasks. Cases and patient details are
          optional.
        </Trans>
      </AuthHeading>
      <div role="radiogroup" aria-label={t`First project`} className="grid grid-cols-3 gap-2.5">
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
              key === recommended ? (
                <StatusTag tone="accent">
                  <Trans>Recommended</Trans>
                </StatusTag>
              ) : undefined
            }
          />
        ))}
      </div>
      <Banner inline tone="info">
        {firsts[u.first].note}
      </Banner>
    </>,
    <>
      <AuthHeading title={t`How do you move around a slide?`}>
        <Trans>Sets the wheel, drag and key defaults. Change any of it later in Settings.</Trans>
      </AuthHeading>
      <div role="radiogroup" aria-label={t`Input device`} className="grid grid-cols-6 gap-2">
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
      <AuthField label={t`Viewer you are used to`}>
        <SegmentedControl
          aria-label={t`Viewer you are used to`}
          value={u.keys}
          onValueChange={(value) => set({ keys: String(value) })}
          options={viewers.map((item) => ({ value: item, label: item }))}
          className="w-140"
          fill
        />
        <span className="text-caption text-fg-dim">
          {u.keys === "Parfocal"
            ? t`Parfocal keys, shown on every button.`
            : t`Keys follow ${u.keys} where they can. Every key can be changed later.`}
        </span>
      </AuthField>
      <AuthField label={t`Theme`}>
        <SegmentedControl
          aria-label={t`Theme`}
          value={u.theme}
          onValueChange={(value) => {
            const theme = value as ThemeChoice;
            chooseTheme(theme);
            set({ theme });
          }}
          options={[
            { value: "dark", label: t`Dark` },
            { value: "light", label: t`Light` },
            { value: "system", label: t`System` },
          ]}
          className="w-75"
          fill
        />
      </AuthField>
    </>,
    <DoneStep
      key="done"
      firstName={firstName}
      role={u.role}
      first={u.first}
      ws={ws === "new" ? "new" : asking ? "asked" : "joined"}
      wsName={wsName ?? ""}
    />,
  ];

  const last = index === stepNames.length - 1;
  const nextLabel =
    index === 1 && asking
      ? t`Send the request and continue`
      : index === 1 && ws === "new"
        ? t`Create it and continue`
        : `Next: ${stepNames[index + 1] ?? ""}`;
  const workspaceMove = () =>
    workspaceMoveOf({
      picked: ws,
      matchedId: asking ? undefined : picked?.id,
      askedId: asking ? picked?.id : undefined,
      name: u.newName,
      mode: u.mode,
    });
  const next = async () => {
    setFailed("");
    try {
      if (index === 0) {
        await updateMe.mutateAsync({
          data: {
            title: u.title === "No title" ? null : u.title,
            specialties: specialtiesOf(u.spec, other ? u.otherSpec : null),
          },
        });
      }
      if (index === 1) {
        const move = workspaceMove();
        const key = JSON.stringify(move);
        if (move.kind !== "none" && key !== moved) {
          if (move.kind === "create") {
            await createWorkspace.mutateAsync({
              data: {
                name: move.name,
                default_privacy_mode: move.privacy,
                logo: logoMarkOf(move.name) || null,
                logo_colour: newWorkspaceColour,
              },
            });
            await queryClient.invalidateQueries();
          } else if (move.kind === "join") {
            await joinWorkspace.mutateAsync({ tenantId: move.workspaceId });
            await queryClient.invalidateQueries();
          } else {
            await askToJoin.mutateAsync({ tenantId: move.workspaceId });
          }
          setMoved(key);
        }
      }
      go(index + 1);
    } catch {
      setFailed(t`That did not go through. Try again, or skip this step and do it later.`);
    }
  };
  const finish = async () => {
    setFailed("");
    try {
      await saveLayers.mutateAsync({
        data: { values: personalValuesOf({ role: u.role, viewer: u.keys }) },
      });
      writeDeviceSetting("wheel_mode", wheelModeOf(u.device));
      const sample = u.first === "sample" ? await createSample.mutateAsync() : undefined;
      if (sample !== undefined && sample.status !== 201) throw new Error("No sample project");
      void router.navigate({ href: firstDestination(u.first, sample?.data.id) });
    } catch {
      setFailed(t`Setup could not be finished. Try again.`);
    }
  };
  const finishLabel =
    u.first === "create"
      ? t`Create my first project`
      : u.first === "wait"
        ? t`Go to my home`
        : t`Open the sample project`;
  return (
    <AuthLayout
      side={
        <AuthStepsSide
          workspace={{
            name: matched?.name ?? "",
            logo: matched?.logo ?? "",
            colour: matched?.logo_colour ?? "transparent",
          }}
          steps={stepNames.map((stepName, at) => ({
            name: stepName,
            sub: at < index ? (summary[at] ?? "") : (stepHints[at] ?? ""),
          }))}
          current={index}
          reached={reached}
          onStepSelect={go}
          note={t`Everything here can be changed later in Settings. Skip any step.`}
        />
      }
    >
      <AuthForm width="wizard">
        {bodies[index]}
        {failed ? (
          <Banner inline tone="bad">
            {failed}
          </Banner>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2.5 border-t border-line pt-4.5">
          {last ? null : (
            <AuthLink onClick={() => go(index + 1)}>
              <Trans>Skip this step</Trans>
            </AuthLink>
          )}
          <span className="flex-1" />
          {index > 0 ? (
            <Button onClick={() => go(index - 1)}>
              <Trans>Back</Trans>
            </Button>
          ) : null}
          {last ? (
            <Button variant="primary" size="lg" onClick={() => void finish()}>
              {finishLabel}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              disabled={index === 1 && ws === "new" && u.newName.trim() === ""}
              onClick={() => void next()}
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
  const { t } = useLingui();

  const workspaceRow: [IconName, string, boolean, string?] =
    ws === "joined"
      ? ["check", `Joined ${wsName}`, true]
      : ws === "asked"
        ? ["mail", t`Asked to join ${wsName}`, false, t`waiting for its admin`]
        : ["check", `Created ${wsName}`, true];
  const projectRow: [IconName, string, boolean, string?] =
    first === "sample"
      ? ["check", t`Sample project ready: 4 slides, 2 result sets`, true]
      : first === "create"
        ? ["folder", t`Create your first project`, false, t`next, after this`]
        : ["bell", t`Wait for an invite from a researcher`, false, t`on your home`];
  const todo: [IconName, string][] =
    role === "res"
      ? [
          ["upload", t`Upload slides and their AI results`],
          ["users", t`Hand slides to reviewers as a review task`],
          ["file", t`Read an evaluation report`],
        ]
      : role === "rev"
        ? [
            ["flag", t`Review your first slide in RT-S1`],
            ["comment", t`Leave a comment on an object ID`],
            ["file", t`Submit your opinion form`],
          ]
        : [
            ["flag", t`Review your first slide in RT-S1`],
            ["upload", t`Upload slides and their AI results`],
            ["users", t`Hand slides to reviewers as a review task`],
          ];
  const rows: [IconName, string, boolean, string?][] = [
    ["check", t`Account and email confirmed`, true],
    workspaceRow,
    projectRow,
    ...todo.map(([icon, text]): [IconName, string, boolean, string] => [
      icon,
      text,
      false,
      t`on your home`,
    ]),
  ];
  return (
    <>
      <AuthHeading title={t`You're set, ${firstName}`}>
        <Trans>
          Your home keeps a short checklist until each part has been tried once.{" "}
          {roles[role].effect}
        </Trans>
      </AuthHeading>
      <ul aria-label={t`Getting started`} className="m-0 grid list-none gap-3 p-0">
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
