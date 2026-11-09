export function scrollRegionProps(label: string) {
  return { role: "region", "aria-label": label, tabIndex: 0 } as const;
}
