import { describe, expect, it, vi } from 'vitest';

import { onVisibleAgain } from './when-visible';

function fakeDocument() {
  const target = new EventTarget();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  const show = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    target.dispatchEvent(new Event('visibilitychange'));
  };
  return { doc, show };
}

describe('onVisibleAgain', () => {
  it('checks when the page comes back into view, at most once a while', () => {
    const { doc, show } = fakeDocument();
    let time = 0;
    const check = vi.fn();
    const stop = onVisibleAgain(check, { minMs: 1000, now: () => time, doc });

    time = 500;
    show('hidden');
    show('visible');
    expect(check).not.toHaveBeenCalled();

    time = 1500;
    show('hidden');
    expect(check).not.toHaveBeenCalled();
    show('visible');
    expect(check).toHaveBeenCalledOnce();

    time = 2000;
    show('visible');
    expect(check).toHaveBeenCalledOnce();

    time = 3000;
    stop();
    show('visible');
    expect(check).toHaveBeenCalledOnce();
  });
});
