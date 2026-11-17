const units = [
  { name: "TB", perTb: 1 },
  { name: "GB", perTb: 1e3 },
  { name: "MB", perTb: 1e6 },
  { name: "KB", perTb: 1e9 },
] as const;

const oneDecimal = (value: number) => +value.toFixed(1);

export function storageSize(terabytes: number): string {
  if (terabytes <= 0) return "0 TB";
  for (const unit of units) {
    const shown = oneDecimal(terabytes * unit.perTb);
    if (shown > 0) return `${shown} ${unit.name}`;
  }
  return "1 KB";
}
