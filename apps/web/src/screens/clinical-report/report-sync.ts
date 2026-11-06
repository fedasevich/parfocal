import type { CaseReport, CaseReportChange, NewCaseReportDeposit } from "@parfocal/api-client";
import { changeBetween, isEmptyChange, newDepositOf } from "./case-report.ts";
import { type Dep, depositMm, type Values } from "./model.ts";

export type ReportWriter = {
  patch: (change: CaseReportChange) => Promise<CaseReport>;
  add: (deposit: NewCaseReportDeposit) => Promise<CaseReport>;
  remove: (serverId: string) => Promise<CaseReport>;
};

export type PushResult = { server: CaseReport | null; saved: Values };

const sameDeposit = (first: Dep, second: Dep) =>
  first.slide === second.slide &&
  first.objectId === second.objectId &&
  depositMm(first) === depositMm(second) &&
  first.note.trim() === second.note.trim();

const syncable = (deposit: Dep, existing: boolean) =>
  depositMm(deposit) !== null || (deposit.objectId !== null && !existing);

export async function pushValues(
  writer: ReportWriter,
  saved: Values,
  current: Values,
): Promise<PushResult> {
  let server: CaseReport | null = null;
  const savedById = new Map(
    saved.deposits.flatMap((deposit) => (deposit.serverId ? [[deposit.serverId, deposit]] : [])),
  );
  const known = new Set(savedById.keys());
  const outcome: Dep[] = [];

  for (const deposit of saved.deposits) {
    const stillThere = current.deposits.find((candidate) => candidate.id === deposit.id);
    if (deposit.serverId && !stillThere) {
      server = await writer.remove(deposit.serverId);
      known.delete(deposit.serverId);
    }
  }

  for (const deposit of current.deposits) {
    const before = deposit.serverId ? savedById.get(deposit.serverId) : undefined;
    if (before && sameDeposit(before, deposit)) {
      outcome.push({ ...deposit });
      continue;
    }
    if (!syncable(deposit, before !== undefined)) {
      outcome.push(before ? { ...before } : withoutServerId(deposit));
      continue;
    }
    if (before?.serverId) {
      server = await writer.remove(before.serverId);
      known.delete(before.serverId);
    }
    server = await writer.add(newDepositOf(deposit));
    const created = server.deposits.find((candidate) => !known.has(candidate.id));
    if (created) known.add(created.id);
    outcome.push({ ...withoutServerId(deposit), ...(created ? { serverId: created.id } : {}) });
  }

  const change = changeBetween(saved, current);
  if (!isEmptyChange(change)) server = await writer.patch(change);

  return { server, saved: { ...current, deposits: outcome } };
}

function withoutServerId(deposit: Dep): Dep {
  const { serverId: _gone, ...rest } = deposit;
  return rest;
}
