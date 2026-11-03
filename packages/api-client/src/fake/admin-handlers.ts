import { HttpResponse, http, type RequestHandler } from "msw";
import { type AdminOverview, adminOverviewSchema } from "../draft/get-admin-overview.ts";
import { type InvitePreview, invitePreviewSchema } from "../draft/get-invite-preview.ts";
import { type SecuritySettings, securitySettingsSchema } from "../draft/get-security-settings.ts";
import { type SignInOptions, signInOptionsSchema } from "../draft/get-sign-in-options.ts";
import { type StorageUsage, storageUsageSchema } from "../draft/get-storage-usage.ts";
import { type AiModels, aiModelsSchema } from "../draft/list-ai-models.ts";
import {
  type JoinableWorkspace,
  joinableWorkspaceListSchema,
} from "../draft/list-joinable-workspaces.ts";
import { type Webhook, webhookListSchema } from "../draft/list-webhooks.ts";
import { type AccessRequest, accessRequestSchema } from "../draft/request-project-access.ts";
import {
  getAcceptInvitationMockHandler,
  getChangeMemberRoleMockHandler,
  getCreateInvitationMockHandler,
  getCreateStudyTemplateMockHandler,
  getGetCurrentTenantMockHandler,
  getGetSessionPolicyMockHandler,
  getInviteTaskReviewerMockHandler,
  getListAuditEventsMockHandler,
  getListInvitationsMockHandler,
  getListMemberActivityMockHandler,
  getListServiceAccountsMockHandler,
  getResendInvitationMockHandler,
  getRevokeInvitationMockHandler,
  getSetMemberAdminRightsMockHandler,
} from "../generated/api.msw.ts";
import type {
  AcceptedInvitation,
  AuditEvent,
  Invitation,
  InvitationDraft,
  Member,
  MemberActivity,
  ServiceAccount,
  SessionPolicy,
  StudyTemplate,
  StudyTemplateDraft,
  TaskInvitationDraft,
  Tenant,
} from "../generated/api.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import {
  type PersonKey,
  people,
  projectByCode,
  projects,
  reviewTasks,
  scenarioNow,
  slideOf,
  slides,
  workspaces,
} from "./scenario.ts";
import {
  adminRightsHolders,
  aiModels,
  auditAt,
  auditEventId,
  auditToday,
  canSignOut,
  dataRules,
  expiredSession,
  institutions,
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

const created: Invitation[] = [];
const withdrawn = new Set<string>();

export const resetAdminActions = () => {
  created.length = 0;
  withdrawn.clear();
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

export const toAdminOverview = (): AdminOverview =>
  adminOverviewSchema.parse({
    people: workspaceTotals.people,
    researchers: workspaceTotals.researchers,
    reviewers: workspaceTotals.reviewers,
    with_admin_rights: workspaceTotals.withAdminRights,
    can_sign_out_user_ids: canSignOut.map((key) => people[key].id),
    projects: workspaceTotals.projects,
    invites_waiting: toInvitations().length,
    models: aiModels.filter((model) => model.shown).length,
    runs_now: runningNow.length,
    stored_tb: Math.round(storage.parts.reduce((sum, part) => sum + part.tb, 0) * 10) / 10,
    capacity_tb: storage.totalTb,
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
  }));

export const toAiModels = (): AiModels =>
  aiModelsSchema.parse({
    models: aiModels.map((model) => ({
      id: model.id,
      name: model.name,
      version: model.version,
      source: model.source,
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

export const toStorageUsage = (): StorageUsage =>
  storageUsageSchema.parse({
    total_tb: storage.totalTb,
    in_place_tb: storage.inPlaceTb,
    parts: storage.parts,
    by_project: storage.byProject.map((row) => ({
      project: ref(row.code),
      colour: projectByCode(row.code).colour,
      gb: row.gb,
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
    })),
  });

export const toWebhooks = (): Webhook[] =>
  webhookListSchema.parse(
    webhooks.map((hook) => ({
      id: hook.id,
      name: hook.name,
      direction: hook.direction,
      events: hook.events,
      calls_today: hook.callsToday,
      rejected_today: hook.rejectedToday,
    })),
  );

export const toSecuritySettings = (): SecuritySettings =>
  securitySettingsSchema.parse({
    sign_in: signInMethods,
    data: [
      {
        key: "idle-lock",
        label: "Lock after inactivity",
        detail: `${sessionPolicy.idleLockMinutes} minutes. Slides and names hide until you sign in again`,
        on: true,
        locked: false,
      },
      ...dataRules,
    ],
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

const slideTarget = /^\/projects\/([^/?#]+)\/slides\/([^/?#]+)(?:\?(.*))?$/;

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

const deepLinkOf = (returnTo: string | null): SignInOptions["deep_link"] => {
  const path = returnTo === null ? defaultReturnPath() : returnTo;
  if (!isSafeReturnPath(path)) return null;
  const match = slideTarget.exec(path);
  const project = projects.find((item) => item.id === match?.[1]);
  const slide = slides.find((item) => item.id === match?.[2] && item.project === project?.code);
  if (project === undefined || slide === undefined) return null;
  const taskId = new URLSearchParams(match?.[3] ?? "").get("task");
  const task = reviewTasks.find((item) => item.id === taskId);
  return {
    path,
    task_id: task?.id ?? null,
    task_code: task?.code ?? null,
    project_id: project.id,
    slide_id: slide.id,
    slide_label: slide.label,
    case_label: slide.caseLabel ?? "Standalone",
  };
};

export const toSignInOptions = (returnTo: string | null = null): SignInOptions =>
  signInOptionsSchema.parse({
    workspace: (({ domain: _domain, ...rest }) => rest)(brandOf(0)),
    email: people.LM.email,
    institutions: institutions.map((item) => {
      const brand = brandOf(item.workspace);
      return {
        workspace_id: brand.id,
        name: brand.name,
        short_name: workspaces[item.workspace]?.organisation ?? brand.name,
        logo: brand.logo,
        colour: brand.colour,
        protocol: item.protocol,
        domain: item.domain,
        matches_email: item.matches,
      };
    }),
    methods: { sso: true, password: true, link: true, passkey: true },
    link_minutes: 15,
    idle_lock_minutes: sessionPolicy.idleLockMinutes,
    session_hours: expiredSession.hours,
    deep_link: deepLinkOf(returnTo),
    last_decision: expiredSession.lastDecision,
  });

export const toJoinableWorkspaces = (): JoinableWorkspace[] =>
  joinableWorkspaceListSchema.parse(
    joinableWorkspaces.map((item) => ({
      ...brandOf(item.workspace),
      members: item.members,
      projects: item.projects,
      matches_email: item.matchesEmail,
    })),
  );

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
  return invitePreviewSchema.parse({
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
  });
};

const toAuditEvents = (): AuditEvent[] =>
  auditToday.map((row, index) => {
    const person = row.by === "webhook" ? null : people[row.by];
    return {
      id: auditEventId(index),
      tenant_id: tenant.id,
      seq: 1000 - index,
      occurred_at: auditAt(row.time),
      actor_kind: person ? "member" : "service",
      actor_id: person?.id ?? null,
      actor_subject: person?.name ?? "Webhook",
      action: row.action,
      target_type: "project",
      target_id: projectByCode(row.project).id,
      target_subject: row.project,
      details: row.details,
      prev_hash: `h${index + 1}`,
      hash: `h${index}`,
    };
  });

const toServiceAccounts = (): ServiceAccount[] =>
  serviceAccounts.map((account) => ({
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
  }));

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
    landing: {
      project_id: preview.project.id,
      task_id: preview.task.id,
      slide_id: preview.task.first_slide_id,
    },
  };
};

const createdTemplate = (draft: StudyTemplateDraft): StudyTemplate => ({
  ...draft,
  id: "00000000-0000-4000-8069-000000000001",
  version: 1,
  built_in: null,
  retired_at: null,
  created_at: scenarioNow,
  version_created_at: scenarioNow,
});

export function adminHandlers(): RequestHandler[] {
  return [
    getListInvitationsMockHandler(() => toInvitations()),
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
    getListAuditEventsMockHandler(() => toAuditEvents()),
    getListServiceAccountsMockHandler(() => toServiceAccounts()),
    getGetSessionPolicyMockHandler(() => toSessionPolicy()),
    getGetCurrentTenantMockHandler(() => toTenant()),
    getSetMemberAdminRightsMockHandler(async ({ request }) => {
      const body = (await request.json()) as { admin_rights: boolean };
      return memberOf(userIdFromPath(request.url), { admin_rights: body.admin_rights });
    }),
    getChangeMemberRoleMockHandler(async ({ request }) => {
      const body = (await request.json()) as { role: Member["role"] };
      return memberOf(userIdFromPath(request.url), { role: body.role });
    }),
    getAcceptInvitationMockHandler(() => joinedWorkspace()),
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
    getCreateStudyTemplateMockHandler(async ({ request }) =>
      createdTemplate((await request.json()) as StudyTemplateDraft),
    ),
  ];
}

export const getGetAdminOverviewMockHandler = (overrideResponse?: AdminOverview) =>
  http.get("*/api/tenant/overview", () => HttpResponse.json(overrideResponse ?? toAdminOverview()));

export const getListAiModelsMockHandler = (overrideResponse?: AiModels) =>
  http.get("*/api/tenant/models", () => HttpResponse.json(overrideResponse ?? toAiModels()));

export const getGetStorageUsageMockHandler = (overrideResponse?: StorageUsage) =>
  http.get("*/api/tenant/storage", () => HttpResponse.json(overrideResponse ?? toStorageUsage()));

export const getListWebhooksMockHandler = (overrideResponse?: Webhook[]) =>
  http.get("*/api/tenant/webhooks", () => HttpResponse.json(overrideResponse ?? toWebhooks()));

export const getGetSecuritySettingsMockHandler = (overrideResponse?: SecuritySettings) =>
  http.get("*/api/tenant/security", () =>
    HttpResponse.json(overrideResponse ?? toSecuritySettings()),
  );

export const getGetInvitePreviewMockHandler = (overrideResponse?: InvitePreview) =>
  http.get("*/api/invitations/:token/preview", () =>
    HttpResponse.json(overrideResponse ?? toInvitePreview()),
  );

export const getGetSignInOptionsMockHandler = (overrideResponse?: SignInOptions) =>
  http.get("*/api/auth/sign-in-options", ({ request }) =>
    HttpResponse.json(
      overrideResponse ?? toSignInOptions(new URL(request.url).searchParams.get("return_to")),
    ),
  );

export const getListJoinableWorkspacesMockHandler = (overrideResponse?: JoinableWorkspace[]) =>
  http.get("*/api/me/joinable-workspaces", () =>
    HttpResponse.json(overrideResponse ?? toJoinableWorkspaces()),
  );

export const getRequestProjectAccessMockHandler = (overrideResponse?: AccessRequest) =>
  http.post<{ projectId: string }>("*/api/projects/:projectId/access-requests", ({ params }) => {
    const project = projects.find((item) => item.id === params.projectId) ?? projects[0];
    return HttpResponse.json(
      overrideResponse ??
        accessRequestSchema.parse({
          id: "00000000-0000-4000-8069-000000000002",
          project_id: project?.id ?? params.projectId,
          user_id: people.AK.id,
          owner_id: people[project?.owner ?? "LM"].id,
          asked_at: scenarioNow,
        }),
    );
  });

export const adminDraftOperations: DraftOperation[] = [
  {
    operationId: "getAdminOverview",
    method: "get",
    path: "/api/tenant/overview",
    handler: () => getGetAdminOverviewMockHandler(),
  },
  {
    operationId: "listAiModels",
    method: "get",
    path: "/api/tenant/models",
    handler: () => getListAiModelsMockHandler(),
  },
  {
    operationId: "getStorageUsage",
    method: "get",
    path: "/api/tenant/storage",
    handler: () => getGetStorageUsageMockHandler(),
  },
  {
    operationId: "listWebhooks",
    method: "get",
    path: "/api/tenant/webhooks",
    handler: () => getListWebhooksMockHandler(),
  },
  {
    operationId: "getSecuritySettings",
    method: "get",
    path: "/api/tenant/security",
    handler: () => getGetSecuritySettingsMockHandler(),
  },
  {
    operationId: "getInvitePreview",
    method: "get",
    path: "/api/invitations/{token}/preview",
    handler: () => getGetInvitePreviewMockHandler(),
  },
  {
    operationId: "getSignInOptions",
    method: "get",
    path: "/api/auth/sign-in-options",
    handler: () => getGetSignInOptionsMockHandler(),
  },
  {
    operationId: "listJoinableWorkspaces",
    method: "get",
    path: "/api/me/joinable-workspaces",
    handler: () => getListJoinableWorkspacesMockHandler(),
  },
  {
    operationId: "requestProjectAccess",
    method: "post",
    path: "/api/projects/{project_id}/access-requests",
    handler: () => getRequestProjectAccessMockHandler(),
  },
];
