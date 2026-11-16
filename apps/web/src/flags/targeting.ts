import { assignArm, isPseudonymousId } from "./assign.ts";

export type FlagRule = {
  arm: string;
  users?: readonly string[];
  workspaces?: readonly string[];
  roles?: readonly string[];
};

export type FlagDefinition = {
  arms: readonly string[];
  default: string;
  mode: "default" | "split";
  killed?: boolean;
  rules?: readonly FlagRule[];
};

export type FlagDefinitions = Readonly<Record<string, FlagDefinition>>;

export type FlagContext = {
  userId: string;
  workspaceId?: string;
  roles?: readonly string[];
};

export type RemoteArms = Readonly<Record<string, string | false>>;

export type FlagReason = "killed" | "remote_off" | "remote" | "rule" | "split" | "default";

export type FlagEvaluation = { arm: string; reason: FlagReason };

const ruleMatches = (rule: FlagRule, context: FlagContext): boolean => {
  const conditions = [
    rule.users === undefined || rule.users.includes(context.userId),
    rule.workspaces === undefined ||
      (context.workspaceId !== undefined && rule.workspaces.includes(context.workspaceId)),
    rule.roles === undefined || (context.roles ?? []).some((role) => rule.roles?.includes(role)),
  ];
  return conditions.every(Boolean);
};

export function evaluateFlag(
  definitions: FlagDefinitions,
  flagKey: string,
  context: FlagContext,
  remote: RemoteArms = {},
): FlagEvaluation {
  const definition = definitions[flagKey];
  if (definition === undefined) throw new Error(`unknown flag ${flagKey}`);
  if (!isPseudonymousId(context.userId)) throw new Error("flags need a pseudonymous user id");
  if (context.workspaceId !== undefined && !isPseudonymousId(context.workspaceId)) {
    throw new Error("flags need a pseudonymous workspace id");
  }
  if (definition.killed === true) return { arm: definition.default, reason: "killed" };
  const remoteArm = remote[flagKey];
  if (remoteArm === false) return { arm: definition.default, reason: "remote_off" };
  if (remoteArm !== undefined && definition.arms.includes(remoteArm)) {
    return { arm: remoteArm, reason: "remote" };
  }
  const rule = definition.rules?.find((candidate) => ruleMatches(candidate, context));
  if (rule !== undefined) return { arm: rule.arm, reason: "rule" };
  if (definition.mode === "split") {
    return { arm: assignArm(flagKey, context.userId, definition.arms), reason: "split" };
  }
  return { arm: definition.default, reason: "default" };
}

export function flagProblems(definitions: FlagDefinitions): string[] {
  const problems: string[] = [];
  for (const [key, definition] of Object.entries(definitions)) {
    if (definition.arms.length === 0) problems.push(`${key} has no arms`);
    if (!definition.arms.includes(definition.default)) problems.push(`${key} default not an arm`);
    if (definition.mode !== "default" && definition.mode !== "split") {
      problems.push(`${key} has an unknown mode`);
    }
    for (const [index, rule] of (definition.rules ?? []).entries()) {
      if (!definition.arms.includes(rule.arm)) problems.push(`${key} rule ${index} arm unknown`);
      if (rule.users === undefined && rule.workspaces === undefined && rule.roles === undefined) {
        problems.push(`${key} rule ${index} has no condition`);
      }
      const ids = [...(rule.users ?? []), ...(rule.workspaces ?? [])];
      if (!ids.every(isPseudonymousId)) problems.push(`${key} rule ${index} has a non id value`);
    }
  }
  return problems;
}
