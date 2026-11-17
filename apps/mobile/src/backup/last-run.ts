import { File, Paths } from 'expo-file-system';

/**
 * What the last backup run did, so Settings can say it and the library knows to refresh.
 * Only a time, counts and a short reason: nothing about the photos themselves.
 */
export interface LastRun {
  /** When it finished (or gave up), in ms since 1970. */
  at: number;
  /** Who started it. */
  by: 'background' | 'you';
  added: number;
  skipped: number;
  /** Why it stopped early or didn't run, in words for Settings; null when it finished. */
  problem: string | null;
}

const file = () => new File(Paths.document, 'backup-last-run.json');

export function parseLastRun(text: string | null): LastRun | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { at, by, added, skipped, problem } = value as Record<string, unknown>;
  const count = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!count(at) || !count(added) || !count(skipped)) return null;
  if (by !== 'background' && by !== 'you') return null;
  if (problem !== null && (typeof problem !== 'string' || problem.length > 300)) return null;
  return { at, by, added, skipped, problem };
}

export async function lastRun(): Promise<LastRun | null> {
  try {
    const saved = file();
    return saved.exists ? parseLastRun(await saved.text()) : null;
  } catch {
    return null;
  }
}

export async function saveLastRun(run: LastRun): Promise<void> {
  try {
    await file().write(JSON.stringify(run));
  } catch {
    // Only for showing; backup works without it.
  }
}

export function forgetLastRun(): void {
  try {
    const saved = file();
    if (saved.exists) saved.delete();
  } catch {
    // Nothing kept.
  }
}

// Hermes may lack Intl's month names, so they're spelled out.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today at 10:51", "Yesterday at 22:05" or "Nov 15 at 08:00". */
function when(at: number, now: number): string {
  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const day = (t: number) => new Date(t).toDateString();
  if (day(at) === day(now)) return `Today at ${time}`;
  if (day(at) === day(now - 24 * 60 * 60 * 1000)) return `Yesterday at ${time}`;
  return `${MONTHS[date.getMonth()] ?? ''} ${String(date.getDate())} at ${time}`;
}

/** What Settings says about the last run. */
export function lastRunText(run: LastRun | null, now: number = Date.now()): string {
  if (!run) return 'Last backup: not yet.';
  const how = run.by === 'background' ? 'in the background' : 'when you asked';
  const head = `Last backup: ${when(run.at, now)}, ${how}.`;
  if (run.problem) return `${head} ${run.problem}`;
  if (run.added === 0) return `${head} Nothing new.`;
  return `${head} ${String(run.added)} photo${run.added === 1 ? '' : 's'} backed up.`;
}
