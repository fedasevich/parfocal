import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAcceptInvitation, useGetInvitePreview } from "@parfocal/api-client";
import {
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLink,
  DotSeparator,
  PasswordMeter,
} from "@parfocal/ui/components/auth";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Stepper } from "@parfocal/ui/components/flow-page";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { StatusTag } from "@parfocal/ui/components/tag";
import { now } from "../../clock.ts";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDue, plural } from "../format.ts";
import { projectColour } from "../palette.ts";
import { toPersonInfo } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { PitchLayout } from "./auth-side.tsx";
import { useNotice } from "./notice.tsx";
import type { InviteScene } from "./scenes.ts";

type Props = { token: string; scene: InviteScene; change: (scene: InviteScene) => void };

const inviteSteps = (scene: InviteScene) => [
  { label: t`Invite`, why: t`Accept the invite first.` },
  { label: t`Your account`, ...(scene === "landing" ? { why: t`Accept the invite first.` } : {}) },
  { label: t`First slide`, why: t`Join first. Your first slide opens after that.` },
];

function Fact({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="contents">
      <dt className="flex items-center gap-2 text-fg-dim">
        <Icon name={icon} />
        {label}
      </dt>
      <dd className="m-0 min-w-0 text-fg">{children}</dd>
    </div>
  );
}

export function InviteScreen({ token, scene, change }: Props) {
  const { t } = useLingui();

  const previewQuery = useGetInvitePreview(token, { query: { retry: false } });
  const preview = okData(previewQuery.data);
  const accept = useAcceptInvitation();
  const goTo = useGoTo();
  const [notice, show] = useNotice();
  const steps = (
    <Stepper
      steps={inviteSteps(scene)}
      current={scene === "landing" ? 0 : 1}
      onStepSelect={(index) => index === 0 && change("landing")}
      className="mb-1"
    />
  );
  if (previewQuery.isError)
    return (
      <PitchLayout>
        <AuthForm>
          <AuthHeading title={t`This invite link does not work`}>
            <Trans>
              It may have expired, been used or been withdrawn. Ask the person who invited you to
              send a new one.
            </Trans>
          </AuthHeading>
          <Button size="lg" block onClick={() => void goTo("/sign-in")}>
            <Trans>Go to sign in</Trans>
          </Button>
        </AuthForm>
      </PitchLayout>
    );
  if (preview === undefined) return <PitchLayout>{null}</PitchLayout>;
  const join = () =>
    accept.mutate(
      { data: { token } },
      {
        onSuccess: (response) => {
          const landing = response.status === 200 ? response.data.landing : null;
          void goTo(
            landing
              ? destinations.slide(landing.project_id, landing.slide_id, landing.task_id)
              : destinations.slide(
                  preview.project.id,
                  preview.task.first_slide_id,
                  preview.task.id,
                ),
          );
        },
      },
    );
  const inviter = toPersonInfo(
    preview.invited_by ?? {
      user_id: "",
      display_name: preview.workspace.name,
      initials: "",
      avatar_colour: 0,
      title: null,
    },
  );
  if (scene === "account") {
    return (
      <PitchLayout>
        <AuthForm>
          {steps}
          <AuthHeading title={t`Join ${preview.project.name}`}>
            <Trans>One step, then your first slide opens.</Trans>
          </AuthHeading>
          <AuthField
            label={t`Email`}
            aside={
              <span className="text-fg-faint">
                <Trans>from the invite</Trans>
              </span>
            }
          >
            <Input
              aria-label={t`Email`}
              value={preview.email}
              readOnly
              className="h-9 opacity-80"
            />
          </AuthField>
          <AuthField label={t`Full name`}>
            <Input aria-label={t`Full name`} defaultValue={preview.name} className="h-9" />
          </AuthField>
          <AuthField label={t`Password`}>
            <Input
              aria-label={t`Password`}
              type="password"
              defaultValue="correct-horse!"
              className="h-9 font-mono"
            />
          </AuthField>
          <PasswordMeter strength={3} label={t`Strong`} />
          <AuthField label={t`Specialty`}>
            <Input
              aria-label={t`Specialty`}
              defaultValue={preview.specialty ?? ""}
              className="h-9"
            />
          </AuthField>
          <span className="flex items-center gap-2.25 text-body-sm text-fg-dim">
            <Checkbox id="invite-terms" defaultChecked />
            <label htmlFor="invite-terms">
              <Trans>I agree to the terms and the data processing agreement</Trans>
            </label>
          </span>
          <Button variant="primary" size="lg" block onClick={join}>
            <Trans>Join and open my first slide</Trans>
          </Button>
          <AuthFoot>
            <AuthLink onClick={join}>
              <Trans>Use Vltava single sign-on instead</Trans>
            </AuthLink>
          </AuthFoot>
        </AuthForm>
      </PitchLayout>
    );
  }
  return (
    <PitchLayout>
      <AuthForm width="wide">
        {steps}
        <AuthHeading title={t`You're invited`}>
          <Trans>Accept to see the slides. Nothing is shared until you do.</Trans>
        </AuthHeading>
        <section
          aria-label={t`The invite`}
          className="grid gap-3.5 rounded-xl border border-line bg-chrome p-4 text-left"
        >
          <div className="flex items-center gap-2.5">
            <PersonAvatar person={inviter} size={32} />
            <span>
              <Trans>
                <b>{inviter.name}</b> invited you to review
              </Trans>
              <small className="block text-body-sm text-fg-dim">
                {preview.invited_by?.title ?? ""} ·
                <Trans>
                  {" "}
                  {plural(
                    Math.max(
                      1,
                      Math.round((now().getTime() - Date.parse(preview.sent_at)) / 3_600_000),
                    ),
                    "hour",
                  )}{" "}
                  ago
                </Trans>
              </small>
            </span>
          </div>
          <div className="flex items-center gap-2.5 rounded-[10px] bg-chrome-2 px-3 py-2.5">
            <span
              aria-hidden="true"
              className="h-8.5 w-1.5 flex-none rounded-[3px]"
              style={{ background: projectColour(preview.project.colour) }}
            />
            <span className="flex-1">
              <b className="block text-body">{preview.project.name}</b>
              <small className="block font-mono text-caption text-fg-faint">
                {preview.project.code} · {preview.project.study_template}
              </small>
            </span>
            <StatusTag tone="accent">
              {preview.project.privacy_mode === "clinical" ? t`Clinical` : t`De-identified`}
            </StatusTag>
          </div>
          <dl className="m-0 grid grid-cols-[132px_minmax(0,1fr)] gap-x-4 gap-y-2 text-body-sm">
            <Fact icon="flag" label={t`Task`}>
              <span className="font-mono">{preview.task.code}</span> · {preview.task.name}
            </Fact>
            <Fact icon="slides" label={t`Slides`}>
              {preview.task.hours === null ? (
                <Trans>{preview.task.slides} slides</Trans>
              ) : (
                <Trans>
                  {preview.task.slides} slides, about {preview.task.hours} hours
                </Trans>
              )}
            </Fact>
            <Fact icon="target" label={t`What to check`}>
              {preview.task.scope}
            </Fact>
            <Fact icon="calendar" label={t`Due`}>
              {preview.task.due_on ? formatDue(preview.task.due_on) : t`No due date`}
            </Fact>
            <Fact icon="eye-off" label={t`Review`}>
              {preview.task.blinded
                ? t`Blind. You see other reviewers after you submit.`
                : t`Open. You see other reviewers as you go.`}
            </Fact>
          </dl>
          {preview.project.privacy_mode === "de-identified" ? (
            <Banner inline tone="info" icon="shield">
              <Trans>
                This project is de-identified. You will not see patient names or numbers.
              </Trans>
            </Banner>
          ) : null}
        </section>
        <Button variant="primary" size="lg" block onClick={() => change("account")}>
          <Trans>Accept and create my account</Trans>
        </Button>
        <Button size="lg" block onClick={() => void goTo("/sign-in")}>
          <Trans>I already have an account, sign in</Trans>
        </Button>
        <AuthFoot>
          <AuthLink
            onClick={() =>
              show(
                t`${inviter.name.split(" ")[0]} is told you declined, with an optional note (mock)`,
              )
            }
          >
            <Trans>Decline</Trans>
          </AuthLink>
          <DotSeparator />
          <Trans>The invite expires on {formatDue(preview.expires_on)}</Trans>
        </AuthFoot>
      </AuthForm>
      {notice}
    </PitchLayout>
  );
}
