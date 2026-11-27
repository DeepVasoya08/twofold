const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A size for people: `512 B`, `1.5 MB`, `120 MB`, `1 TB`. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 100 && unit > 0 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded.toLocaleString('en-US')} ${UNITS[unit] ?? 'TB'}`;
}
