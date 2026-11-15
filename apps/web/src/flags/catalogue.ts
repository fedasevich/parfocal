export const flagCatalogue = {
  lab_lead_default_home: ["control", "status_board"],
} as const satisfies Record<string, readonly string[]>;

export type FlagKey = keyof typeof flagCatalogue;

export type ArmOf<Key extends FlagKey> = (typeof flagCatalogue)[Key][number];

export const flagKeys: readonly FlagKey[] = Object.keys(flagCatalogue) as FlagKey[];

export const flagArms: readonly string[] = [...new Set(Object.values(flagCatalogue).flat())];
