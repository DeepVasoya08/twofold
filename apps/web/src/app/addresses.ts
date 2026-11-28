import { newRandomName } from '@arcafold/crypto/webcrypto';

/**
 * Addresses in the app never hold an id. The first time an address points at a photo, album,
 * file, folder or person, that thing gets a random name, and every name is forgotten when
 * Arcafold locks. So the tab's Back button, the browser's history and anything else that keeps
 * addresses only ever hold names that mean nothing once Arcafold has locked: they can't be
 * matched to a library or a private space, and the server has never seen them
 * (docs/security.md#addresses-hold-no-ids).
 */

const idsByName = new Map<string, string>();
const namesById = new Map<string, string>();

/** The name addresses use for `id` until Arcafold locks. */
export function nameFor(id: string): string {
  const known = namesById.get(id);
  if (known !== undefined) return known;
  const name = newRandomName();
  namesById.set(id, name);
  idsByName.set(name, id);
  return name;
}

/** The id an address's name stands for, or null for a name from before Arcafold last locked. */
export function idNamed(name: string): string | null {
  return idsByName.get(name) ?? null;
}

/** Forgets every name, so no address from before works again. Done whenever Arcafold locks. */
export function forgetNames(): void {
  idsByName.clear();
  namesById.clear();
}
