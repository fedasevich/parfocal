import type { InboxItem, Preference } from "@parfocal/api-client";
import { readDeviceSettings, writeDeviceSetting } from "./device-settings.ts";

export type NoticeChannel = "email" | "bell" | "quiet";

export type StatNotice = { channel: NoticeChannel; sound: boolean };

export const statDefaults: StatNotice = { channel: "email", sound: true };

const channels: readonly string[] = ["email", "bell", "quiet"];

export function readStatNotice(): StatNotice {
  const stored = readDeviceSettings();
  const channel = stored.notice_stat;
  const sound = stored.stat_sound;
  return {
    channel:
      typeof channel === "string" && channels.includes(channel)
        ? (channel as NoticeChannel)
        : statDefaults.channel,
    sound: typeof sound === "boolean" ? sound : statDefaults.sound,
  };
}

export const writeStatChannel = (channel: NoticeChannel) =>
  writeDeviceSetting("notice_stat", channel);

export const writeStatSound = (sound: boolean) => writeDeviceSetting("stat_sound", sound);

export const isStat = (item: InboxItem): boolean =>
  item.kind === "task-assigned" && item.payload.priority === "stat";

export function shownInBell(item: InboxItem, preferences: Preference[], stat: StatNotice): boolean {
  if (isStat(item)) return stat.channel !== "quiet";
  const preference = preferences.find((candidate) => candidate.kind === item.kind);
  if (preference === undefined || preference.mandatory) return true;
  return preference.in_app;
}

export function statToChime(
  items: InboxItem[],
  heard: ReadonlySet<string>,
  stat: StatNotice,
): InboxItem[] {
  if (!stat.sound || stat.channel === "quiet") return [];
  return items.filter((item) => isStat(item) && !item.read && !heard.has(item.id));
}

export function playChime() {
  try {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const level = context.createGain();
    tone.frequency.value = 880;
    level.gain.setValueAtTime(0.15, context.currentTime);
    level.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
    tone.connect(level).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.4);
    tone.onended = () => void context.close();
  } catch {
    return;
  }
}
