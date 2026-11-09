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
