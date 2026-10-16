import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';

import {
  FITTED,
  STEP_SCALE,
  clampView,
  containedSize,
  isZoomed,
  panBy,
  wheelFactor,
  zoomAt,
} from '../lib/zoom';
import type { Point, ZoomView } from '../lib/zoom';

const SWIPE_PX = 50;

interface Gesture {
  pointers: Map<number, Point>;
  /** Where a single touch started, for swipes. Cleared once the gesture pans or pinches. */
  swipeFrom: number | null;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Wheel, pinch, drag and double-click zoom for the photo viewer. `resetKey` changes when a
 * different photo is shown, which starts it fitted again. A one-finger swipe on a fitted
 * photo calls `onSwipe` instead.
 */
export function useZoom({
  stageRef,
  imageRef,
  resetKey,
  onSwipe,
}: {
  stageRef: RefObject<HTMLElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  resetKey: string;
  onSwipe: (direction: 'prev' | 'next') => void;
}) {
  const [view, setView] = useState<ZoomView>(FITTED);
  const [shownKey, setShownKey] = useState(resetKey);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture>({ pointers: new Map(), swipeFrom: null });

  if (shownKey !== resetKey) {
    setShownKey(resetKey);
    setView(FITTED);
  }

  /** Applies a change, kept inside the limits for the image as it is drawn now. */
  const update = useCallback(
    (change: (current: ZoomView) => ZoomView) => {
      const image = imageRef.current;
      if (!image) return;
      const box = { width: image.offsetWidth, height: image.offsetHeight };
      const drawn = containedSize({ width: image.naturalWidth, height: image.naturalHeight }, box);
      setView((current) => clampView(change(current), drawn, box));
    },
    [imageRef],
  );

  /** A screen point, measured from the centre of the image's box. */
  const fromCentre = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = imageRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      // The box is transformed; its centre moves with the pan but not with the scale.
      return {
        x: clientX - (rect.left + rect.width / 2),
        y: clientY - (rect.top + rect.height / 2),
      };
    },
    [imageRef],
  );

  // React's wheel listener is passive, so it can't stop the page scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = wheelFactor(event.deltaY, event.deltaMode);
      const at = fromCentre(event.clientX, event.clientY);
      update((current) => zoomAt(current, factor, offsetFromView(current, at)));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      stage.removeEventListener('wheel', onWheel);
    };
  }, [stageRef, fromCentre, update]);

  const zoomBy = (factor: number) => {
    update((current) => zoomAt(current, factor, { x: 0, y: 0 }));
  };

  const reset = () => {
    setView(FITTED);
  };

  const onDoubleClick = (event: { clientX: number; clientY: number }) => {
    const at = fromCentre(event.clientX, event.clientY);
    update((current) =>
      isZoomed(current) ? FITTED : zoomAt(current, STEP_SCALE, offsetFromView(current, at)),
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // Buttons on the stage keep their clicks.
    if (event.target instanceof Element && event.target.closest('button')) return;
    const { pointers } = gesture.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current.swipeFrom =
      pointers.size === 1 && event.pointerType !== 'mouse' ? event.clientX : null;
    if (pointers.size === 1 && isZoomed(view)) setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const { pointers } = gesture.current;
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const now = { x: event.clientX, y: event.clientY };
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const other = a === previous ? b : a;
      const before = distance(previous, other);
      const factor = before > 0 ? distance(now, other) / before : 1;
      const from = midpoint(previous, other);
      const to = midpoint(now, other);
      const at = fromCentre(to.x, to.y);
      update((current) =>
        panBy(zoomAt(current, factor, offsetFromView(current, at)), to.x - from.x, to.y - from.y),
      );
      gesture.current.swipeFrom = null;
    } else if (isZoomed(view)) {
      update((current) => panBy(current, now.x - previous.x, now.y - previous.y));
      gesture.current.swipeFrom = null;
    }
    pointers.set(event.pointerId, now);
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const { pointers, swipeFrom } = gesture.current;
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size > 0) return;
    setDragging(false);
    gesture.current.swipeFrom = null;
    if (swipeFrom === null || isZoomed(view) || event.type !== 'pointerup') return;
    const dx = event.clientX - swipeFrom;
    if (dx > SWIPE_PX) onSwipe('prev');
    else if (dx < -SWIPE_PX) onSwipe('next');
  };

  return {
    view,
    zoomed: isZoomed(view),
    dragging,
    zoomBy,
    reset,
    stageHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onDoubleClick,
    },
  };
}

/**
 * `fromCentre` measures from the box's centre after the pan, but `zoomAt` wants the point
 * relative to the unpanned centre, where the view's offset is measured from.
 */
function offsetFromView(current: ZoomView, atFromPannedCentre: Point): Point {
  return { x: atFromPannedCentre.x + current.x, y: atFromPannedCentre.y + current.y };
}
