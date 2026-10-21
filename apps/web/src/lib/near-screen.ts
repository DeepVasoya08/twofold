/**
 * Calls back once when an element comes near the screen, so work for it (like downloading a
 * thumbnail) waits until someone could see it. One observer serves every element. Where the
 * browser has no IntersectionObserver, every element counts as near at once.
 */

/** How far outside the screen still counts as near: about two screens on a phone. */
export const NEAR_MARGIN = '1200px 0px';

/** Called with whether the element is on the screen itself, not just near it. */
type Callback = (onScreen: boolean) => void;

let observer: IntersectionObserver | null = null;
const callbacks = new Map<Element, Callback>();

function shared(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        stopObserving(entry.target);
        callback?.(isOnScreen(entry.boundingClientRect));
      }
    },
    { rootMargin: NEAR_MARGIN },
  );
  return observer;
}

function isOnScreen(rect: DOMRectReadOnly): boolean {
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < globalThis.innerHeight &&
    rect.left < globalThis.innerWidth
  );
}

function stopObserving(element: Element): void {
  callbacks.delete(element);
  observer?.unobserve(element);
}

/**
 * Watches `element` and calls `onNear` the first time it is near the screen, saying whether
 * it is on the screen itself.
 */
export function whenNearScreen(element: Element, onNear: Callback): () => void {
  const watcher = shared();
  if (!watcher) {
    onNear(false);
    return () => undefined;
  }
  callbacks.set(element, onNear);
  watcher.observe(element);
  return () => {
    stopObserving(element);
  };
}
