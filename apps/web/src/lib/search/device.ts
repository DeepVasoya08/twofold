/**
 * What Smart search needs to know about the device: whether it's a phone (phones work out
 * vectors for their own uploads only, and download resources on Wi-Fi), and how it's
 * connected, where the browser says.
 */

interface NavigatorLike {
  userAgent: string;
  userAgentData?: { mobile?: boolean };
  connection?: { type?: string; saveData?: boolean };
}

export function isPhone(nav: NavigatorLike): boolean {
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  return /Android|iPhone|iPod|Mobile/i.test(nav.userAgent);
}

/**
 * How the device is connected. Most browsers don't say (Safari and Firefox never do), so
 * 'unknown' is common; 'metered' is a phone network or data saver.
 */
export type Connection = 'wifi' | 'metered' | 'unknown';

export function connection(nav: NavigatorLike): Connection {
  const info = nav.connection;
  if (info?.saveData === true || info?.type === 'cellular') return 'metered';
  if (info?.type === 'wifi' || info?.type === 'ethernet') return 'wifi';
  return 'unknown';
}
