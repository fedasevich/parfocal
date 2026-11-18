import { HttpResponse, http, type RequestHandler } from "msw";
import {
  getAcceptInvitationMockHandler,
  getAskToJoinWorkspaceMockHandler,
  getChangeMemberRoleMockHandler,
  getCreateInvitationMockHandler,
  getCreateServiceAccountMockHandler,
  getExportAuditEventsMockHandler,
  getGetAdminOverviewMockHandler,
  getGetCurrentTenantMockHandler,
  getGetSecuritySettingsMockHandler,
  getGetSessionPolicyMockHandler,
  getGetStorageUsageMockHandler,
  getInviteTaskReviewerMockHandler,
  getIssueApiTokenMockHandler,
  getJoinWorkspaceMockHandler,
  getListAiModelsMockHandler,
  getListAuditEventsMockHandler,
  getListInvitationsMockHandler,
  getListJoinableWorkspacesMockHandler,
  getListMemberActivityMockHandler,
  getListServiceAccountsMockHandler,
  getListWebhooksMockHandler,
  getRequestProjectAccessMockHandler,
  getResendInvitationMockHandler,
  getRevokeApiTokenMockHandler,
  getRevokeInvitationMockHandler,
  getSetMemberAdminRightsMockHandler,
} from "../generated/api.msw.ts";
import type {
  AcceptedInvitation,
  AdminOverview,
  AiModels,
  ApiToken,
  AuditExport,
  Invitation,
  InvitationDraft,
  InvitePreview,
  IssuedToken,
  JoinableWorkspace,
  Member,
  MemberActivity,
  NamedAuditEvent,
  ProjectAccessRequest,
  SecuritySettings,
  ServiceAccount,
  ServiceAccountDraft,
  SessionPolicy,
  StorageUsage,
  TaskInvitationDraft,
  Tenant,
  Webhook,
  Workspace,
  WorkspaceAccessRequest,
} from "../generated/api.ts";
import { isModelHidden } from "./hidden-models.ts";
import {
  type PersonKey,
  people,
  projectByCode,
  projects,
  reviewTasks,
  scenarioNow,
  slideOf,
  workspaces,
} from "./scenario.ts";
import {
  type AiModelSeed,
  adminRightsHolders,
  aiModels,
  auditAt,
  auditEventId,
  auditPseudonym,
  auditToday,
  canSignOut,
  invitations,
  inviteSeed,
  joinableWorkspaces,
  memberActivity,
  projectsOf,
  runningNow,
  serviceAccounts,
  sessionPolicy,
  signInDeepLink,
  signInMethods,
  sources,
  storage,
  tenant,
  twoFactor,
  webhooks,
  workspaceBrands,
  workspaceTotals,
} from "./scenario-admin.ts";
import { resetStudyTemplates } from "./study-template-store.ts";
import { resetWorkspaceJoin } from "./workspace-join-handlers.ts";

const created: Invitation[] = [];
const withdrawn = new Set<string>();

const recordedAudit: NamedAuditEvent[] = [];
const addedAccounts: ServiceAccount[] = [];
const addedTokens = new Map<string, ApiToken[]>();
const revokedTokens = new Set<string>();

export const resetAdminActions = () => {
  created.length = 0;
  withdrawn.clear();
  recordedAudit.length = 0;
  addedAccounts.length = 0;
  addedTokens.clear();
  revokedTokens.clear();
  resetStudyTemplates();
  resetWorkspaceJoin();
};

const recordAudit = (action: string, targetType: string, targetId: string, subject: string) => {
  const actor = people.DH;
  const pseudonym = auditPseudonym("DH");
  recordedAudit.unshift({
    id: `00000000-0000-4000-8070-${String(recordedAudit.length + 1).padStart(12, "0")}`,
    tenant_id: tenant.id,
    seq: 2000 + recordedAudit.length,
    occurred_at: scenarioNow,
    actor_kind: "member",
    actor_id: pseudonym,
    actor_subject: `fake-subject-${pseudonym}`,
    action,
    target_type: targetType,
    target_id: targetId,
    target_subject: subject,
    details: subject,
    prev_hash: `r${recordedAudit.length + 1}`,
    hash: `r${recordedAudit.length}`,
    actor_user_id: actor.id,
    actor_name: actor.name,
  });
};

const newInvitationId = () =>
  `00000000-0000-4000-8060-${String(100 + created.length).padStart(12, "0")}`;

const ref = (code: (typeof projects)[number]["code"]) => {
  const project = projectByCode(code);
  return { id: project.id, code: project.code, name: project.name };
};

const toInvitation = (seed: (typeof invitations)[number]): Invitation => ({
  id: seed.id,
  tenant_id: tenant.id,
  email: seed.email,
  role: seed.role,
  admin_rights: seed.adminRights,
  created_at: seed.createdAt,
  expires_at: seed.expiresAt,
  expired: false,
});

export const toInvitations = (): Invitation[] =>
  [...invitations.map(toInvitation), ...created].filter(
    (invitation) => !withdrawn.has(invitation.id),
  );

export const toAdminOverview = (): AdminOverview => ({
  people: workspaceTotals.people,
  researchers: workspaceTotals.researchers,
  reviewers: workspaceTotals.reviewers,
  with_admin_rights: workspaceTotals.withAdminRights,
  can_sign_out_user_ids: canSignOut.map((key) => people[key].id),
  projects: workspaceTotals.projects,
  invites_waiting: toInvitations().length,
  models: toAiModels().models.filter((model) => model.shown).length,
  runs_now: runningNow.length,
  stored_tb: Math.round(storage.parts.reduce((sum, part) => sum + part.tb, 0) * 10) / 10,
  capacity_tb: storage.capacityTb,
  in_place_tb: storage.inPlaceTb,
  webhook_calls_today: webhooks[0]?.callsToday ?? 0,
  webhook_rejected_today: webhooks.reduce((sum, hook) => sum + hook.rejectedToday, 0),
});

export const toMemberActivity = (): MemberActivity[] =>
  memberActivity.map((row) => ({
    user_id: people[row.key].id,
    email: people[row.key].email,
    last_active_at: row.lastActiveAt,
    project_codes: projectsOf(row.key),
    deactivates_on: null,
    deactivated_at: null,
  }));

function withVisibility(model: AiModelSeed): AiModelSeed {
  if (model.source !== "parfocal" || model.catalogueName === null) return model;
  if (isModelHidden(model.catalogueName)) {
    return { ...model, shown: false, status: "hidden", whoCanRun: "Nobody while hidden" };
  }
  return model.shown
    ? model
    : { ...model, shown: true, status: "active", whoCanRun: "Researchers" };
}

export const toAiModels = (): AiModels => ({
  models: aiModels.map(withVisibility).map((model) => ({
    id: model.id,
    name: model.name,
    version: model.version,
    source: model.source,
    catalogue_name: model.catalogueName,
    makes: model.makes,
    description: model.description,
    runs_on: model.runsOn,
    who_can_run: model.whoCanRun,
    result_sets: model.resultSets,
    shown: model.shown,
    status: model.status,
    latency_ms: model.latencyMs,
  })),
  running: runningNow.map((run) => ({
    id: run.id,
    model: run.model,
    project: ref(run.project),
    slides: run.slides,
    slides_done: run.slidesDone,
    started_by: people[run.by].id,
  })),
});

const TERABYTE = 1e12;
const GIGABYTE = 1e9;

export const toStorageUsage = (): StorageUsage => {
  const used = storage.parts.reduce((sum, part) => sum + part.tb, 0);
  return {
    total_tb: Math.round(used * 1000) / 1000,
    total_bytes: Math.round(used * TERABYTE),
    capacity_tb: storage.capacityTb,
    in_place_tb: storage.inPlaceTb,
    in_place_bytes: Math.round(storage.inPlaceTb * TERABYTE),
    parts: storage.parts.map((part) => ({ ...part, bytes: Math.round(part.tb * TERABYTE) })),
    by_project: storage.byProject.map((row) => ({
      project: ref(row.code),
      colour: projectByCode(row.code).colour,
      gb: row.gb,
      bytes: Math.round(row.gb * GIGABYTE),
      cap_gb: row.capGb,
    })),
    rules: storage.rules,
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      access: source.access,
      address: source.address,
      new_slides: source.newSlides,
      health: source.health,
      first_tile_ms: source.firstTileMs,
      expires_in_days: source.expiresInDays,
      slides_in_place: source.slidesInPlace,
      last_read_at: source.slidesInPlace > 0 ? "2026-10-15T10:40:00+02:00" : null,
    })),
  };
};

export const toWebhooks = (): Webhook[] =>
  webhooks.map((hook) => ({
    id: hook.id,
    name: hook.name,
    direction: hook.direction,
    events: hook.events,
    calls_today: hook.callsToday,
    rejected_today: hook.rejectedToday,
    project: ref(hook.project),
    address: hook.address,
    paused: hook.paused,
  }));

export const toSecuritySettings = (): SecuritySettings => ({
  sign_in: signInMethods,
  two_factor: twoFactor,
});

const brandOf = (index: number) => {
  const workspace = workspaces[index] ?? workspaces[0];
  const brand = workspaceBrands[index] ?? workspaceBrands[0];
  return {
    id: workspace?.id ?? "",
    name: workspace?.name ?? "",
    logo: brand?.logo ?? "",
    colour: brand?.colour ?? "",
    domain: brand?.domain ?? "",
  };
};

export const isSafeReturnPath = (value: string) =>
  value.startsWith("/") &&
  !value.startsWith("//") &&
  !value.includes("\\") &&
  !value.split("").some((character) => character.charCodeAt(0) < 0x20);

export const defaultReturnPath = () => {
  const slide = slideOf("P07", signInDeepLink.caseLabel, signInDeepLink.slide);
  const task = reviewTasks.find((item) => item.code === signInDeepLink.task);
  return `/projects/${projectByCode("P07").id}/slides/${slide.id}?task=${task?.id ?? ""}`;
};

export const toJoinableWorkspaces = (): JoinableWorkspace[] =>
  joinableWorkspaces.map((item) => {
    const { colour, ...brand } = brandOf(item.workspace);
    return {
      ...brand,
      logo_colour: colour,
      members: item.members,
      projects: item.projects,
      how: item.how,
      asked: false,
    };
  });

const joinedTo = (tenantId: string): Workspace => {
  const index = Math.max(
    0,
    workspaces.findIndex((item) => item.id === tenantId),
  );
  const workspace = workspaces[index];
  const brand = brandOf(index);
  return {
    tenant_id: brand.id,
    role: "reviewer",
    admin_rights: false,
    slug: workspace?.slug ?? "",
    name: brand.name,
    kind: workspace?.kind ?? "research",
    status: "active",
    organisation_name: workspace?.organisation ?? brand.name,
    logo: brand.logo,
    logo_colour: brand.colour,
  };
};

const askedFor = (tenantId: string): WorkspaceAccessRequest => ({
  id: "00000000-0000-4000-8069-000000000003",
  tenant_id: tenantId,
  user_id: people.LM.id,
  status: "pending",
  asked_at: scenarioNow,
});

const tenantIdFromPath = (url: string) => new URL(url).pathname.split("/").at(-2) ?? "";

const personRef = (key: PersonKey) => ({
  user_id: people[key].id,
  display_name: people[key].name,
  initials: people[key].key,
  avatar_colour: people[key].colour,
  title: people[key].title,
});

export const toInvitePreview = (): InvitePreview => {
  const task = reviewTasks.find((item) => item.code === inviteSeed.task) ?? reviewTasks[0];
  if (task === undefined) throw new Error("The scenario has no review task to invite to.");
  const project = projectByCode(task.project);
  const workspace = brandOf(0);
  return {
    token: inviteSeed.invitation,
    email: people[inviteSeed.to].email,
    name: people[inviteSeed.to].name,
    invited_by: personRef(inviteSeed.by),
    sent_at: inviteSeed.sentAt,
    workspace: { id: workspace.id, name: workspace.name },
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      colour: project.colour,
      privacy_mode: project.privacy,
      study_template: project.studyTemplate,
    },
    task: {
      id: task.id,
      code: task.code,
      name: task.name,
      slides: task.slides,
      hours: inviteSeed.hours,
      scope: task.scopeText,
      due_on: task.dueOn,
      blinded: task.blinded,
      first_slide_id: slideOf("P07", "S26-04812", "A1").id,
    },
    specialty: inviteSeed.specialty,
    expires_on: inviteSeed.expiresOn,
  };
};

const toAuditEvents = (): NamedAuditEvent[] => [...recordedAudit, ...seededAuditEvents()];

const seededAuditEvents = (): NamedAuditEvent[] =>
  auditToday.map((row, index) => {
    const person = row.by === "webhook" ? null : people[row.by];
    const pseudonym = row.by === "webhook" ? null : auditPseudonym(row.by);
    return {
      id: auditEventId(index),
      tenant_id: tenant.id,
      seq: 1000 - index,
      occurred_at: auditAt(row.time, row.day),
      actor_kind: person ? "member" : "service",
      actor_id: pseudonym,
      actor_subject: pseudonym === null ? null : `fake-subject-${pseudonym}`,
      action: row.action,
      target_type: "project",
      target_id: projectByCode(row.project).id,
      target_subject: row.project,
      details: row.details,
      prev_hash: `h${index + 1}`,
      hash: `h${index}`,
      actor_user_id: person?.id ?? null,
      actor_name: person?.name ?? null,
    };
  });

const auditMatches = (event: NamedAuditEvent, query: URLSearchParams) => {
  const person = query.get("person");
  const project = query.get("project_id");
  const actions = query.getAll("action");
  const prefix = query.get("action_prefix");
  const since = query.get("since");
  const until = query.get("until");
  const at = Date.parse(event.occurred_at);
  return (
    (person === null || event.actor_user_id === person) &&
    (project === null || (event.target_type === "project" && event.target_id === project)) &&
    (actions.length === 0 || actions.includes(event.action)) &&
    (prefix === null || event.action.startsWith(prefix)) &&
    (since === null || at >= Date.parse(since)) &&
    (until === null || at < Date.parse(until))
  );
};

const filteredAuditEvents = (url: string) => {
  const query = new URL(url).searchParams;
  return toAuditEvents().filter((event) => auditMatches(event, query));
};

const toAuditExport = (url: string): AuditExport => {
  const query = new URL(url).searchParams;
  const events = filteredAuditEvents(url);
  const filters = Object.fromEntries(
    [...new Set(query.keys())].map((key) => [
      key,
      key === "action" ? query.getAll(key) : query.get(key),
    ]),
  );
  const head = toAuditEvents()[0];
  return {
    format: "parfocal-audit-export",
    version: 1,
    tenant_id: tenant.id,
    generated_at: scenarioNow,
    filters,
    chain_head: head ? { seq: head.seq, hash: head.hash } : null,
    events: events.map(({ actor_user_id, actor_name, ...event }) => ({
      ...event,
      emergency: false,
      reason: null,
    })),
    signature: {
      algorithm: "Ed25519",
      key_id: "fake-master:audit-v1",
      value: "ZmFrZS1zaWduYXR1cmU",
    },
  };
};

const withRevoked = (token: ApiToken): ApiToken =>
  revokedTokens.has(token.id) ? { ...token, revoked_at: token.revoked_at ?? scenarioNow } : token;

const toServiceAccounts = (): ServiceAccount[] =>
  [
    ...serviceAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      scopes: account.scopes,
      disabled_at: null,
      created_at: "2026-09-10T09:00:00+02:00",
      tokens: [
        {
          id: account.tokenId,
          created_at: "2026-09-10T09:00:00+02:00",
          expires_at: "2027-09-10T09:00:00+02:00",
          revoked_at: null,
          last_used_at: account.lastUsedAt,
        },
      ],
    })),
    ...addedAccounts,
  ].map((account) => ({
    ...account,
    tokens: [...account.tokens, ...(addedTokens.get(account.id) ?? [])].map(withRevoked),
  }));

const newFakeId = (block: number) =>
  `00000000-0000-4000-80${block}-${String(100 + addedAccounts.length + addedTokens.size + revokedTokens.size).padStart(12, "0")}`;

const issueFakeToken = (accountId: string, days: number): IssuedToken => {
  const id = newFakeId(91);
  const expires = new Date(Date.parse(scenarioNow) + days * 86_400_000).toISOString();
  addedTokens.set(accountId, [
    ...(addedTokens.get(accountId) ?? []),
    { id, created_at: scenarioNow, expires_at: expires, revoked_at: null, last_used_at: null },
  ]);
  return { id, token: `pf_fake${id.replaceAll("-", "").slice(-20)}`, expires_at: expires };
};

const toSessionPolicy = (): SessionPolicy => ({
  tenant_id: tenant.id,
  idle_lock_minutes: sessionPolicy.idleLockMinutes,
  session_hours: sessionPolicy.sessionHours,
  emergency_hours: sessionPolicy.emergencyHours,
});

const toTenant = (): Tenant => {
  const workspace = workspaces[0];
  return {
    id: tenant.id,
    organisation_id: tenant.organisationId,
    slug: workspace?.slug ?? "",
    name: workspace?.name ?? "",
    kind: workspace?.kind ?? "research",
    region: "eu",
    plan: "pilot",
    status: "active",
    suspended_at: null,
    created_at: tenant.createdAt,
    updated_at: tenant.createdAt,
  };
};

const memberOf = (userId: string, change: Partial<Member>): Member => {
  const person = Object.values(people).find((item) => item.id === userId) ?? people.LM;
  return {
    user_id: person.id,
    display_name: person.name,
    initials: person.key,
    avatar_colour: person.colour,
    title: person.title,
    role: person.role,
    admin_rights: adminRightsHolders.includes(person.key),
    ...change,
  };
};

const userIdFromPath = (url: string) => url.split("/members/")[1]?.split("/")[0] ?? "";

const joinedWorkspace = (): AcceptedInvitation => {
  const workspace = workspaces[0];
  const preview = toInvitePreview();
  return {
    tenant_id: tenant.id,
    role: "reviewer",
    admin_rights: false,
    slug: workspace?.slug ?? "",
    name: workspace?.name ?? "",
    kind: workspace?.kind ?? "research",
    status: "active",
    organisation_name: workspace?.organisation ?? "",
    logo: brandOf(0).logo,
    logo_colour: brandOf(0).colour,
    landing: {
      project_id: preview.project.id,
      task_id: preview.task.id,
      slide_id: preview.task.first_slide_id,
    },
  };
};

export function adminHandlers(): RequestHandler[] {
  return [
    getListAiModelsMockHandler(() => toAiModels()),
    getGetAdminOverviewMockHandler(() => toAdminOverview()),
    getGetStorageUsageMockHandler(() => toStorageUsage()),
    getListWebhooksMockHandler(() => toWebhooks()),
    getGetSecuritySettingsMockHandler(() => toSecuritySettings()),
    invitePreviewHandler(),
    getListInvitationsMockHandler(() => toInvitations()),
    getRequestProjectAccessMockHandler(({ params }) =>
      toProjectAccessRequest(String(params.projectId)),
    ),
    getCreateInvitationMockHandler(async ({ request }) => {
      const body = (await request.json()) as InvitationDraft;
      const invitation: Invitation = {
        id: newInvitationId(),
        tenant_id: tenant.id,
        email: body.email.trim().toLowerCase(),
        role: body.role,
        admin_rights: body.role === "researcher" && (body.admin_rights ?? false),
        created_at: scenarioNow,
        expires_at: "2026-10-29T23:59:00+02:00",
        expired: false,
      };
      created.push(invitation);
      return invitation;
    }),
    getResendInvitationMockHandler(({ request }) => {
      const earlierId = new URL(request.url).pathname.split("/").at(-2) ?? "";
      const earlier = toInvitations().find((invitation) => invitation.id === earlierId);
      if (earlier === undefined) throw new Error(`No pending invitation ${earlierId}`);
      recordAudit("invitation.resent", "invitation", earlier.id, earlier.email);
      const resent: Invitation = {
        ...earlier,
        id: newInvitationId(),
        created_at: scenarioNow,
        expires_at: "2026-10-29T23:59:00+02:00",
        expired: false,
      };
      withdrawn.add(earlier.id);
      created.push(resent);
      return resent;
    }),
    getRevokeInvitationMockHandler(({ request }) => {
      withdrawn.add(new URL(request.url).pathname.split("/").at(-1) ?? "");
    }),
    getListMemberActivityMockHandler(() => toMemberActivity()),
    getListAuditEventsMockHandler(({ request }) => filteredAuditEvents(request.url)),
    getExportAuditEventsMockHandler(({ request }) => toAuditExport(request.url)),
    getListServiceAccountsMockHandler(() => toServiceAccounts()),
    getCreateServiceAccountMockHandler(async ({ request }) => {
      const body = (await request.json()) as ServiceAccountDraft;
      const account: ServiceAccount = {
        id: newFakeId(90),
        name: body.name.trim(),
        scopes: [...body.scopes].sort(),
        disabled_at: null,
        created_at: scenarioNow,
        tokens: [],
      };
      addedAccounts.push(account);
      const token = issueFakeToken(account.id, body.expires_in_days ?? 90);
      recordAudit("service-account.created", "service-account", account.id, account.name);
      return {
        account: toServiceAccounts().find((one) => one.id === account.id) ?? account,
        token,
      };
    }),
    getIssueApiTokenMockHandler(async ({ request, params }) => {
      const body = (await request.json()) as { expires_in_days?: number };
      return issueFakeToken(String(params.accountId), body.expires_in_days ?? 90);
    }),
    getRevokeApiTokenMockHandler(({ params }) => {
      revokedTokens.add(String(params.tokenId));
    }),
    getGetSessionPolicyMockHandler(() => toSessionPolicy()),
    getGetCurrentTenantMockHandler(() => toTenant()),
    getSetMemberAdminRightsMockHandler(async ({ request }) => {
      const body = (await request.json()) as { admin_rights: boolean };
      const member = memberOf(userIdFromPath(request.url), { admin_rights: body.admin_rights });
      recordAudit(
        body.admin_rights ? "member.admin-rights-given" : "member.admin-rights-removed",
        "member",
        member.user_id,
        member.display_name,
      );
      return member;
    }),
    getChangeMemberRoleMockHandler(async ({ request }) => {
      const body = (await request.json()) as { role: Member["role"] };
      const member = memberOf(userIdFromPath(request.url), { role: body.role });
      recordAudit("member.role-changed", "member", member.user_id, member.display_name);
      return member;
    }),
    getAcceptInvitationMockHandler(() => joinedWorkspace()),
    getListJoinableWorkspacesMockHandler(() => toJoinableWorkspaces()),
    getJoinWorkspaceMockHandler(({ request }) => joinedTo(tenantIdFromPath(request.url))),
    getAskToJoinWorkspaceMockHandler(({ request }) => askedFor(tenantIdFromPath(request.url))),
    getInviteTaskReviewerMockHandler(async ({ request, params }) => {
      const body = (await request.json()) as TaskInvitationDraft;
      const invitation: Invitation = {
        id: newInvitationId(),
        tenant_id: tenant.id,
        email: body.email.trim().toLowerCase(),
        role: "reviewer",
        admin_rights: false,
        created_at: scenarioNow,
        expires_at: "2026-10-29T23:59:00+02:00",
        expired: false,
        task_id: String(params["taskId"]),
      };
      created.push(invitation);
      return invitation;
    }),
  ];
}

export const invitePreviewHandler = (overrideResponse?: InvitePreview) =>
  http.get("*/api/invitations/:token/preview", ({ params }) =>
    overrideResponse === undefined && params.token !== inviteSeed.invitation
      ? HttpResponse.json(
          { title: "Invitation not found", status: 404, detail: "This invite link does not work." },
          { status: 404, headers: { "content-type": "application/problem+json" } },
        )
      : HttpResponse.json(overrideResponse ?? toInvitePreview()),
  );

export const toProjectAccessRequest = (projectId: string): ProjectAccessRequest => {
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  return {
    id: "00000000-0000-4000-8069-000000000002",
    project_id: project?.id ?? projectId,
    user_id: people.AK.id,
    owner_id: people[project?.owner ?? "LM"].id,
    asked_at: scenarioNow,
  };
};
