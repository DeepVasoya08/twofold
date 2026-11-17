import type { NewPhoto } from '@arcafold/core/library/space-store';

import type { DeleteResult } from '../../modules/memory-image';

const photos = (count: number): string => (count === 1 ? '1 photo' : `${String(count)} photos`);

/**
 * Remembers which picked photos made it into the private space, so their originals can be
 * deleted from the phone afterwards. Only their gallery addresses are kept, in memory, and
 * only until you choose (or Arcafold locks). A photo is counted once it's stored, never
 * before, so nothing that failed to upload is offered for deletion.
 */
export class Originals {
  private readonly sources = new WeakMap<NewPhoto, string>();
  private stored: string[] = [];
  private readonly listeners = new Set<() => void>();

  /** Notes where a prepared photo came from. */
  prepared(photo: NewPhoto, uri: string): void {
    this.sources.set(photo, uri);
  }

  /** Counts a photo once it's stored in the space. */
  storedPhoto(photo: NewPhoto): void {
    const uri = this.sources.get(photo);
    if (uri === undefined) return;
    this.sources.delete(photo);
    if (this.stored.includes(uri)) return;
    this.stored = [...this.stored, uri];
    this.emit();
  }

  /** How many stored photos are still waiting for a choice. */
  getCount = (): number => this.stored.length;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Hands over the waiting photos' addresses and forgets them. */
  take(): string[] {
    const taken = this.stored;
    this.stored = [];
    if (taken.length > 0) this.emit();
    return taken;
  }

  /** Puts photos back to wait again, when asking about them didn't work. */
  giveBack(uris: readonly string[]): void {
    const back = uris.filter((uri) => !this.stored.includes(uri));
    if (back.length === 0) return;
    this.stored = [...back, ...this.stored];
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The offer, once photos picked from the gallery are in the private space. */
export function originalsText(count: number): string {
  return count === 1
    ? 'This photo is now in your private space, and still in your phone’s gallery. Delete it from the gallery?'
    : `These ${photos(count)} are now in your private space, and still in your phone’s gallery. Delete them from the gallery?`;
}

/** How deleting went, or null when everything asked for was deleted. */
export function deletedText(result: DeleteResult): string | null {
  if (result.kept === 0) return null;
  if (result.deleted === 0) return 'Nothing was deleted from the gallery.';
  return `${photos(result.deleted)} deleted from the gallery. ${String(result.kept)} couldn’t be, so delete ${result.kept === 1 ? 'it' : 'them'} in your gallery app.`;
}
