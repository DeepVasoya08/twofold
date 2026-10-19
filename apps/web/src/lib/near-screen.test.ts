import { afterEach, describe, expect, it, vi } from 'vitest';

type Entries = { target: Element; isIntersecting: boolean }[];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('whenNearScreen', () => {
  it('calls back once, the first time the element comes near the screen', async () => {
    let report: (entries: Entries) => void = () => undefined;
    const unobserve = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Entries) => void) {
          report = callback;
        }
        observe = vi.fn();
        unobserve = unobserve;
      },
    );
    const { whenNearScreen } = await import('./near-screen');
    const element = {} as Element;
    const onNear = vi.fn();
    whenNearScreen(element, onNear);
    report([{ target: element, isIntersecting: false }]);
    expect(onNear).not.toHaveBeenCalled();
    report([{ target: element, isIntersecting: true }]);
    report([{ target: element, isIntersecting: true }]);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(unobserve).toHaveBeenCalledWith(element);
  });

  it('stops watching when cancelled', async () => {
    let report: (entries: Entries) => void = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Entries) => void) {
          report = callback;
        }
        observe = vi.fn();
        unobserve = vi.fn();
      },
    );
    const { whenNearScreen } = await import('./near-screen');
    const element = {} as Element;
    const onNear = vi.fn();
    whenNearScreen(element, onNear)();
    report([{ target: element, isIntersecting: true }]);
    expect(onNear).not.toHaveBeenCalled();
  });

  it('counts everything as near where the browser can’t tell', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { whenNearScreen } = await import('./near-screen');
    const onNear = vi.fn();
    whenNearScreen({} as Element, onNear);
    expect(onNear).toHaveBeenCalledTimes(1);
  });
});
