import {
  type Invitation,
  type Member,
  useChangeMemberRole,
  useCreateInvitation,
  useGetAdminOverview,
  useListInvitations,
  useListMemberActivity,
  useListProjects,
  useListTenantMembers,
  useResendInvitation,
  useRevokeInvitation,
  useSetMemberAdminRights,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { AvatarStack, Person } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { Switch } from "@parfocal/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { StatusTag } from "@parfocal/ui/components/tag";
import { TokenField } from "@parfocal/ui/components/token-field";
import { Zone } from "@parfocal/ui/components/zone";
import { useState } from "react";
import { toPersonInfo } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { lastActive, MoreButton, type Notify, tableClass } from "./common.tsx";
import { adminSwitchOf, type PeopleFilter, shownInvitations, takenEmails } from "./people-rules.ts";

type Filter = PeopleFilter;

const roleText = { researcher: "Researcher", reviewer: "Reviewer" } as const;

const roleDefinitions = [
  {
    name: "Researcher",
    does: "Runs studies. Creates projects and owns them, uploads slides and AI results, runs models, sets a project's classes, opinion form and study template, creates review tasks and invites reviewers, resolves disagreements or asks an adjudicator, signs off, and arranges, exports and shares the report. Reviews too when a task names them",
    never: "Opens a project without a project role. Clinical projects open only with a reason",
    who: "researcher",
  },
  {
    name: "Reviewer",
    does: "Reviews the slides of their tasks. Agree, Disagree or Unsure on each object with optional reasons and a note, fixes outlines and types, adds what the AI missed, comments, fills the opinion form and submits each slide. Decides queued objects when asked to adjudicate",
    never:
      "Uploads, runs models, creates projects or tasks, signs off, sees other decisions before submitting in a blind task, opens Admin",
    who: "reviewer",
  },
  {
    name: "Admin rights, on a researcher",
    does: "Sets up the workspace on this page: people and their roles, projects, AI models, report templates, storage and sources, API and webhooks, the audit log and security",
    never: "Sees project data because of the right. The last researcher with it cannot lose it",
    who: "admin",
  },
  {
    name: "Can sign out, a project right in a clinical project",
    does: "Signs out the clinical report of a case in that project. On by default for the case's assigned pathologist, set by the project owner. A member without it sends the report for co-sign to someone who has it",
    never:
      "Signs out in a de-identified project, where there is no clinical report. Signs out a research evaluation, which is the researcher's sign-off",
    who: "sign-out",
  },
] as const;

export function PeopleSection({
  notify,
  inviting,
  setInviting,
}: {
  notify: Notify;
  inviting: boolean;
  setInviting: (open: boolean) => void;
}) {
  const members = okData(useListTenantMembers().data) ?? [];
  const activity = okData(useListMemberActivity().data) ?? [];
  const invitationList = useListInvitations();
  const invitations = okData(invitationList.data) ?? [];
  const overview = useGetAdminOverview().data?.data;
  const setRights = useSetMemberAdminRights();
  const changeRole = useChangeMemberRole();
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const [rights, setRightsState] = useState<Record<string, boolean>>({});
  const [roles, setRoles] = useState<Record<string, Member["role"]>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  const roleOf = (member: Member) => roles[member.user_id] ?? member.role;
  const rightOf = (member: Member) => rights[member.user_id] ?? member.admin_rights;
  const activityOf = (member: Member) => activity.find((row) => row.user_id === member.user_id);
  const rows = members.filter((member) => {
    const email = activityOf(member)?.email ?? "";
    const matches =
      find.trim() === "" ||
      `${member.display_name} ${email}`.toLowerCase().includes(find.trim().toLowerCase());
    if (!matches) return false;
    if (filter === "res") return roleOf(member) === "researcher";
    if (filter === "rev") return roleOf(member) === "reviewer";
    if (filter === "adm") return rightOf(member);
    return true;
  });
  const holders = members.filter(rightOf);
  const toggleRight = (member: Member) => {
    const was = rightOf(member);
    if (adminSwitchOf(roleOf(member), was, holders.length) === "locked") return;
    const apply = (on: boolean) => {
      setRightsState((current) => ({ ...current, [member.user_id]: on }));
      setRights.mutate(
        { userId: member.user_id, data: { admin_rights: on } },
        {
          onSuccess: (response) => {
            if (response.status === 200) return;
            setRightsState((current) => ({ ...current, [member.user_id]: !on }));
            notify(problemText(response.data));
          },
        },
      );
    };
    apply(!was);
    notify(
      was
        ? `${member.display_name} no longer has admin rights and stays a researcher.`
        : `${member.display_name} has admin rights now and can open Admin.`,
      () => apply(was),
    );
  };
  const changeRoleOf = (member: Member, next: Member["role"]) => {
    const was = roleOf(member);
    setRoles((current) => ({ ...current, [member.user_id]: next }));
    changeRole.mutate(
      { userId: member.user_id, data: { role: next } },
      {
        onSuccess: (response) => {
          if (response.status === 200) {
            notify(`${member.display_name} is a ${roleText[next].toLowerCase()} now.`);
            return;
          }
          setRoles((current) => ({ ...current, [member.user_id]: was }));
          notify(problemText(response.data));
        },
      },
    );
  };
  const resendTo = (invitation: Invitation) =>
    resend.mutate(
      { invitationId: invitation.id },
      {
        onSuccess: (response) => {
          void invitationList.refetch();
          notify(
            response.status === 201
              ? `Invite sent again to ${invitation.email}. The earlier link no longer works.`
              : problemText(response.data),
          );
        },
      },
    );
  const withdraw = (invitation: Invitation) =>
    revoke.mutate(
      { invitationId: invitation.id },
      { onSuccess: () => void invitationList.refetch() },
    );
  const shownInvites = shownInvitations(invitations, find, filter);
  const waiting = invitations.length;
  const signOutIds = overview?.can_sign_out_user_ids ?? [];
  const peopleFor = (who: (typeof roleDefinitions)[number]["who"]) => {
    if (who === "admin") return members.filter(rightOf);
    if (who === "sign-out") return members.filter((member) => signOutIds.includes(member.user_id));
    return members.filter((member) => roleOf(member) === who);
  };
  const countFor = (who: (typeof roleDefinitions)[number]["who"]) => {
    if (overview === undefined) return 0;
    if (who === "admin") return overview.with_admin_rights;
    if (who === "sign-out") return signOutIds.length;
    return who === "researcher" ? overview.researchers : overview.reviewers;
  };
  return (
    <>
      <Zone
        title="People"
        end={<span className="text-body-sm text-fg-dim">{waiting} invites waiting</span>}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="relative flex w-72 items-center">
            <Icon name="search" className="absolute left-2.5 text-fg-faint" />
            <Input
              aria-label="Find by name or email"
              placeholder="Find by name or email"
              value={find}
              onChange={(event) => setFind(event.target.value)}
              className="pl-8"
            />
          </span>
          <SegmentedControl
            aria-label="Show"
            value={filter}
            onValueChange={(value) => setFilter(value as Filter)}
            options={[
              { value: "all", label: `All ${overview?.people ?? members.length}` },
              { value: "res", label: "Researchers" },
              { value: "rev", label: "Reviewers" },
              { value: "adm", label: "With admin rights" },
            ]}
          />
        </div>
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Admin rights</TableHead>
              <TableHead>Projects</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((member) => {
              const row = activityOf(member);
              const role = roleOf(member);
              return (
                <TableRow key={member.user_id}>
                  <TableCell>
                    <Person person={toPersonInfo(member)} size={28} sub={row?.email ?? ""} />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={role}
                      onValueChange={(value) => changeRoleOf(member, value as Member["role"])}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`Role of ${member.display_name}`}
                        className="w-32"
                      >
                        <SelectValue>{roleText[role]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="researcher">Researcher</SelectItem>
                        <SelectItem value="reviewer">Reviewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {adminSwitchOf(role, rightOf(member), holders.length) !== "absent" ? (
                      <Switch
                        aria-label={`Admin rights for ${member.display_name}`}
                        checked={rightOf(member)}
                        disabled={adminSwitchOf(role, rightOf(member), holders.length) === "locked"}
                        onCheckedChange={() => toggleRight(member)}
                      />
                    ) : (
                      <span className="text-fg-faint">Researchers only</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">{row?.project_codes.join(", ")}</TableCell>
                  <TableCell>{lastActive(row?.last_active_at ?? null)}</TableCell>
                  <TableCell>
                    <StatusTag tone="ok">Active</StatusTag>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center justify-end gap-1.5">
                      <MoreButton label={`More for ${member.display_name}`} />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            {shownInvites.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell>
                  <Person
                    person={{
                      name: invitation.email,
                      initials: invitation.email.slice(0, 2).toUpperCase(),
                      color: "var(--chrome-3)",
                    }}
                    size={28}
                    sub={`Invited ${lastActive(invitation.created_at).toLowerCase()}`}
                  />
                </TableCell>
                <TableCell>{roleText[invitation.role]}</TableCell>
                <TableCell>
                  {invitation.admin_rights ? "Yes" : <span className="text-fg-faint">No</span>}
                </TableCell>
                <TableCell>
                  <span className="text-fg-faint">None yet</span>
                </TableCell>
                <TableCell>Not yet</TableCell>
                <TableCell>
                  <StatusTag tone="warn">
                    {invitation.expired ? "Invite expired" : "Invite sent"}
                  </StatusTag>
                </TableCell>
                <TableCell>
                  <span className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      aria-label={`Resend the invite to ${invitation.email}`}
                      disabled={resend.isPending}
                      onClick={() => resendTo(invitation)}
                    >
                      Resend
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <span className="text-body-sm text-fg-dim">
          {rows.length} of {overview?.people ?? members.length} shown. At least one researcher keeps
          admin rights, and giving or removing them is in the audit log.
        </span>
      </Zone>
      <Zone
        title="What each role is responsible for"
        sub="Two roles apply in the whole workspace. Admin rights are a switch on a researcher, not a third role, and add no access to project data. Inside a project people are also owner, reviewer or viewer. The server enforces all of it, the screens only hide what someone cannot use."
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Responsible for</TableHead>
              <TableHead>Never</TableHead>
              <TableHead>People</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roleDefinitions.map((definition) => (
              <TableRow key={definition.name} className="align-top">
                <TableCell className="w-44 py-3 whitespace-normal">
                  <b>{definition.name}</b>
                </TableCell>
                <TableCell className="py-3 whitespace-normal text-fg-dim">
                  {definition.does}
                </TableCell>
                <TableCell className="py-3 whitespace-normal text-fg-dim">
                  {definition.never}
                </TableCell>
                <TableCell className="py-3">
                  <span className="flex items-center gap-2">
                    <AvatarStack people={peopleFor(definition.who).map(toPersonInfo)} size={22} />
                    <span className="font-mono">{countFor(definition.who)}</span>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Zone>
      <InvitePeopleModal
        open={inviting}
        taken={takenEmails(activity, invitations)}
        onClose={() => setInviting(false)}
        onSent={(invitation) => {
          void invitationList.refetch();
          notify(`Invite sent to ${invitation.email}`, () => withdraw(invitation));
        }}
      />
    </>
  );
}

function problemText(body: unknown): string {
  const title = (body as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "That did not work. Try again.";
}

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function InvitePeopleModal({
  open,
  taken,
  onClose,
  onSent,
}: {
  open: boolean;
  taken: string[];
  onClose: () => void;
  onSent: (invitation: Invitation) => void;
}) {
  const projects = okData(useListProjects().data) ?? [];
  const create = useCreateInvitation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("reviewer");
  const [picked, setPicked] = useState<string[]>([]);
  const [admin, setAdmin] = useState(false);
  const [tried, setTried] = useState(false);
  const trimmed = email.trim().toLowerCase();
  const error = !emailPattern.test(trimmed)
    ? "Enter an email address."
    : taken.includes(trimmed)
      ? `${trimmed} is already a member here.`
      : undefined;
  const reset = () => {
    setEmail("");
    setRole("reviewer");
    setPicked([]);
    setAdmin(false);
    setTried(false);
  };
  return (
    <SmallModal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
      title="Invite people"
      subtitle="To Fakultní nemocnice Vltava"
      width={560}
      hint="They get a one-step sign-up."
      primaryLabel="Send invite"
      primaryBusy={create.isPending}
      blockers={tried && error ? [{ id: "email", text: error, goTo: "Go to the email" }] : []}
      blockersTitle="Before you can invite"
      onPrimary={() => {
        setTried(true);
        if (error) return;
        create.mutate(
          { data: { email: trimmed, role, admin_rights: role === "researcher" && admin } },
          {
            onSuccess: (response) => {
              if (response.status !== 201) return;
              onSent(response.data);
              reset();
              onClose();
            },
          },
        );
      }}
    >
      <FormField label="Email" error={tried ? error : undefined}>
        <TextFieldInput
          type="email"
          placeholder="name@hospital.example"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <div className="grid gap-1.5">
        <span id="invite-role" className="text-caption font-semibold text-fg-dim">
          Role
        </span>
        <SegmentedControl
          aria-labelledby="invite-role"
          value={role}
          onValueChange={(value) => setRole(value as Member["role"])}
          options={[
            { value: "researcher", label: "Researcher" },
            { value: "reviewer", label: "Reviewer" },
          ]}
        />
        <small className="text-caption text-fg-dim">
          {role === "researcher"
            ? "Runs studies, uploads, creates review tasks and signs off."
            : "Reviews the slides of the tasks they are given."}
        </small>
      </div>
      <TokenField
        label="Projects, optional"
        placeholder="Add projects by name"
        items={projects.map((project) => ({
          id: project.id,
          name: `${project.code} · ${project.name}`,
          sub: project.privacy_mode === "clinical" ? "Clinical" : "De-identified",
          find: project.name,
        }))}
        picked={picked}
        onPickedChange={setPicked}
      />
      {role === "researcher" ? (
        <label className="flex cursor-pointer items-center justify-between gap-4 text-body-sm">
          <span>
            <b className="block">Admin rights</b>
            <small className="text-caption text-fg-dim">
              People, models, storage and templates. Adds no access to project data.
            </small>
          </span>
          <Switch checked={admin} onCheckedChange={setAdmin} />
        </label>
      ) : null}
    </SmallModal>
  );
}
