import type { ScanState } from './use-scan';

/** Big numbers as people read them: "1,234". */
const count = (n: number) => n.toLocaleString('en-US');

/**
 * What Settings says under a smart feature's switch: how far this phone (and your other
 * devices) have got, and what it's waiting for. Never mentions models: they're "resources".
 */
export function scanText(scan: ScanState, lookedAt: { done: number; total: number }): string {
  const progress = `${count(lookedAt.done)} of ${count(lookedAt.total)} photos looked at.`;
  switch (scan.state) {
    case 'off':
      return 'Off on this phone. Your other devices can still look at photos.';
    case 'loading':
      return 'Getting ready…';
    case 'done':
      return `All ${count(lookedAt.total)} photos looked at.`;
    case 'waiting-for-wifi':
      return `${progress} Waiting for Wi-Fi to download some resources the first time.`;
    case 'downloading':
      return `Downloading resources (${String(Math.floor((scan.received / Math.max(1, scan.total)) * 100))}%)…`;
    case 'scanning':
      return `${progress} Looking at photos while Arcafold is open.`;
    case 'paused':
      return `${progress} Waiting while photos upload or other photos are looked at.`;
    case 'failed':
      return scan.message;
  }
}
