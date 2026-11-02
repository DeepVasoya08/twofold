import { planApple } from './apple';
import { planTakeout } from './takeout';
import type { ImportPlan, ImportSource } from './takeout';

/** Where an export came from, as far as its files tell. */
export type ExportKind = 'google' | 'apple' | 'photos';

/** Tells a Google Takeout export from an Apple one, or from a plain folder of photos. */
export function exportKind(sources: readonly ImportSource[]): ExportKind {
  const paths = sources.map((source) => source.path);
  if (
    paths.some(
      (path) =>
        path.toLowerCase().endsWith('.json') || /(^|\/)(Takeout|Google Photos)\//.test(path),
    )
  ) {
    return 'google';
  }
  if (paths.some((path) => /(^|\/)Photo Details[^/]*\.csv$/i.test(path))) return 'apple';
  return 'photos';
}

/** Plans an import from whatever export was picked. */
export async function planExport(
  sources: readonly ImportSource[],
): Promise<ImportPlan & { kind: ExportKind }> {
  const kind = exportKind(sources);
  const plan = kind === 'google' ? planTakeout(sources) : await planApple(sources);
  return { ...plan, kind };
}
