/** The first letter of a name, for an avatar without a photo. */
export function initialOf(name: string): string {
  return (name.trim().at(0) ?? '?').toUpperCase();
}
