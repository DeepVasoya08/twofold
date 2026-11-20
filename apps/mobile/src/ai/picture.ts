import type { Picture } from '@arcafold/core/picture';

import { MemoryImages } from '../../modules/memory-image';

/** A picture native code couldn't decode or draw: that photo is passed over. */
class Unreadable extends Error {}

/**
 * A decrypted preview as a Picture for the AI models: its bytes go to native memory (like
 * every decrypted image on the phone), are decoded and drawn there, and are wiped when
 * `look` is done. Null when the bytes aren't a picture native code can draw.
 */
export async function withPicture<T>(
  bytes: Uint8Array,
  look: (picture: Picture) => Promise<T>,
): Promise<T | null> {
  const id = MemoryImages.put(bytes);
  // The native copy is the one used; this one is wiped at once.
  bytes.fill(0);
  try {
    const size = await MemoryImages.sizeAsync(id).catch(() => null);
    if (!size) return null;
    return await look({
      width: size.width,
      height: size.height,
      draw: async (side, transform, smooth = false) => {
        const drawn = await MemoryImages.drawAsync(id, side, [...transform], smooth).catch(() => {
          throw new Unreadable();
        });
        return new Uint8Array(drawn);
      },
    });
  } catch (error) {
    if (error instanceof Unreadable) return null;
    throw error;
  } finally {
    MemoryImages.release(id);
  }
}
