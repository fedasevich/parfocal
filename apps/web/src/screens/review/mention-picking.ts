import type { MentionOption } from "@parfocal/ui/components/comment-thread";
import type { PersonInfo } from "@parfocal/ui/components/person";

export type Mentionable = {
  id: string;
  name: string;
  person: PersonInfo;
  sub: string;
};

export const mentionQuery = (text: string) => text.match(/(^|\s)@([^\s@]{0,24})$/)?.[2];

export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function mentionOptions(
  text: string,
  members: Mentionable[],
  meId: string | undefined,
  blindReviewers: string[],
): MentionOption[] {
  const query = mentionQuery(text);
  if (query === undefined) return [];
  return members
    .filter((member) => member.id !== meId)
    .filter((member) =>
      fold(member.name)
        .split(" ")
        .some((word) => word.startsWith(fold(query))),
    )
    .map((member) => ({
      id: member.id,
      person: member.person,
      sub: member.sub,
      ...(blindReviewers.includes(member.id) ? { disabledReason: "Reviews this task blind" } : {}),
    }));
}

export function withMention(text: string, name: string) {
  return text.replace(/@([^\s@]{0,24})$/, `@${name} `);
}

const hex = "[0-9a-fA-F]";
const mentionToken = new RegExp(`@\\[(${hex}{8}-${hex}{4}-${hex}{4}-${hex}{4}-${hex}{12})\\]`, "g");

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const tokenFor = (userId: string) => `@[${userId}]`;

export function toMentionTokens(text: string, members: Pick<Mentionable, "id" | "name">[]) {
  const named = members
    .filter((member) => member.name.trim() !== "")
    .sort((a, b) => b.name.length - a.name.length);
  if (!named.length) return text;
  const idOf = new Map(named.map((member) => [member.name, member.id]));
  const pattern = new RegExp(
    `@(${named.map((member) => escaped(member.name)).join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );
  return text.replace(pattern, (found, name: string) => {
    const id = idOf.get(name);
    return id ? tokenFor(id) : found;
  });
}

export function fromMentionTokens(text: string, nameOf: (userId: string) => string | undefined) {
  return text.replace(mentionToken, (found, id: string) => {
    const name = nameOf(id.toLowerCase());
    return name ? `@${name}` : found;
  });
}

export function fromMentionTokensOrNull(
  text: string | null,
  nameOf: (userId: string) => string | undefined,
) {
  return text === null ? null : fromMentionTokens(text, nameOf);
}
