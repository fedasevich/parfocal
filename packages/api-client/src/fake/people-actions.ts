import type { Deactivation, Invitation, Member } from "../generated/api.ts";

const storeKey = "parfocal.fake.people-actions";

interface PeopleStore {
  roles: Record<string, Member["role"]>;
  rights: Record<string, boolean>;
  withdrawn: string[];
  invitations: Invitation[];
  leaving: Record<string, Deactivation>;
}

const emptyStore = (): PeopleStore => ({
  roles: {},
  rights: {},
  withdrawn: [],
  invitations: [],
  leaving: {},
});

const session = (): Storage | null =>
  typeof sessionStorage === "undefined" ? null : sessionStorage;

let memory: PeopleStore = emptyStore();

const read = (): PeopleStore => {
  const stored = session()?.getItem(storeKey);
  return stored === null || stored === undefined ? memory : (JSON.parse(stored) as PeopleStore);
};

const write = (store: PeopleStore) => {
  memory = store;
  session()?.setItem(storeKey, JSON.stringify(store));
};

export const resetPeopleActions = () => {
  memory = emptyStore();
  session()?.removeItem(storeKey);
};

export const changedMember = (member: Member): Member => {
  const store = read();
  return {
    ...member,
    role: store.roles[member.user_id] ?? member.role,
    admin_rights: store.rights[member.user_id] ?? member.admin_rights,
  };
};

export const keepRole = (userId: string, role: Member["role"]) => {
  const store = read();
  write({ ...store, roles: { ...store.roles, [userId]: role } });
};

export const keepRights = (userId: string, admin: boolean) => {
  const store = read();
  write({ ...store, rights: { ...store.rights, [userId]: admin } });
};

export const createdInvitations = (): Invitation[] => read().invitations;

export const keepInvitation = (invitation: Invitation) => {
  const store = read();
  write({ ...store, invitations: [...store.invitations, invitation] });
};

export const isWithdrawn = (invitationId: string): boolean =>
  read().withdrawn.includes(invitationId);

export const withdrawInvitation = (invitationId: string) => {
  const store = read();
  write({ ...store, withdrawn: [...store.withdrawn, invitationId] });
};

export const leavingOf = (userId: string): Deactivation | undefined => read().leaving[userId];

export const keepLeaving = (leaving: Deactivation) => {
  const store = read();
  write({ ...store, leaving: { ...store.leaving, [leaving.user_id]: leaving } });
};

export const dropLeaving = (userId: string) => {
  const store = read();
  const { [userId]: _gone, ...rest } = store.leaving;
  write({ ...store, leaving: rest });
};
