/** How long after one check a tab coming back into view checks again. */
export const RECHECK_MS = 30_000;

/**
 * Runs `check` whenever the page comes back into view, but not again within `minMs` of the
 * last time, so flicking between tabs doesn't send a request each time. Returns a function
 * that stops listening.
 */
export function onVisibleAgain(
  check: () => void,
  {
    minMs = RECHECK_MS,
    now = () => Date.now(),
    doc = document,
  }: {
    minMs?: number;
    now?: () => number;
    doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  } = {},
): () => void {
  let last = now();
  const onChange = () => {
    if (doc.visibilityState !== 'visible' || now() - last < minMs) return;
    last = now();
    check();
  };
  doc.addEventListener('visibilitychange', onChange);
  return () => {
    doc.removeEventListener('visibilitychange', onChange);
  };
}
