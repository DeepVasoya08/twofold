/**
 * Keeps the spike open when a test hits an error nobody caught: instead of React Native's
 * default (close the app), the error is kept and shown, so it can be shared with the results.
 * Imported first in index.ts.
 */
interface ErrorUtilsShape {
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

const errors: string[] = [];
const listeners = new Set<() => void>();

export function caughtErrors(): readonly string[] {
  return errors;
}

export function onCaughtError(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const utils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
utils?.setGlobalHandler((error, isFatal) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  errors.push(`${isFatal ? 'fatal' : 'error'}: ${message}`);
  for (const listener of listeners) listener();
});
