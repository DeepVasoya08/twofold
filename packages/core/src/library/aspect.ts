/**
 * A photo's shape for the uncropped view, its width over its height (1 when the size isn't
 * known): each photo keeps its shape, so this is its share of its row. Kept within 1:3 and
 * 3:1 so a panorama or a long screenshot doesn't take over a row. Used by the web and phone.
 */
export function aspectOf(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(3, Math.max(1 / 3, width / height));
}
