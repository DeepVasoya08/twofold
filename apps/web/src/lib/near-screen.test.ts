import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Entries = {
  target: Element;
  isIntersecting: boolean;
  boundingClientRect?: Partial<DOMRectReadOnly>;
}[];

const offScreen = { top: 5000, bottom: 5200, left: 0, right: 200 };
const onScreen = { top: 10, bottom: 210, left: 0, right: 200 };

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
});

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
    report([{ target: element, isIntersecting: false, boundingClientRect: offScreen }]);
    expect(onNear).not.toHaveBeenCalled();
    report([{ target: element, isIntersecting: true, boundingClientRect: offScreen }]);
    report([{ target: element, isIntersecting: true, boundingClientRect: onScreen }]);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(onNear).toHaveBeenCalledWith(false);
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

  it('says when the element is on the screen itself, not just near it', async () => {
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
    whenNearScreen(element, onNear);
    report([{ target: element, isIntersecting: true, boundingClientRect: onScreen }]);
    expect(onNear).toHaveBeenCalledWith(true);
  });

  it('counts everything as near where the browser can’t tell', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { whenNearScreen } = await import('./near-screen');
    const onNear = vi.fn();
    whenNearScreen({} as Element, onNear);
    expect(onNear).toHaveBeenCalledTimes(1);
  });
});
