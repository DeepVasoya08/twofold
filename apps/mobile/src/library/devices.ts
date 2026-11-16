const HOUR_MS = 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 16, 2026". Written out by hand: the phone's JavaScript has no relative-time formats. */
export function shortDay(time: number): string {
  const date = new Date(time);
  return `${MONTHS[date.getMonth()] ?? ''} ${String(date.getDate())}, ${String(date.getFullYear())}`;
}

/** "Active recently", "Active 3 hours ago", "Active 2 days ago", or the day for older ones. */
export function lastActiveText(lastActive: number, now: number): string {
  const hours = Math.floor((now - lastActive) / HOUR_MS);
  if (hours < 1) return 'Active recently';
  if (hours < 24) return `Active ${hours === 1 ? '1 hour' : `${String(hours)} hours`} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'Active yesterday' : `Active ${String(days)} days ago`;
  return `Active ${shortDay(lastActive)}`;
}
