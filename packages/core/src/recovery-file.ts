/**
 * The recovery key as a text file, saved to the person's own device when they say they've
 * saved it (a download on the web, a folder they pick on a phone). It's made on the device and
 * never sent anywhere.
 */

export const RECOVERY_FILE_NAME = 'arcafold-recovery-key.txt';

/** The file's text: the 12 words, numbered, with what they're for. */
export function recoveryFileText(words: readonly string[]): string {
  const numbered = words.map((word, index) => `${String(index + 1).padStart(2, ' ')}. ${word}`);
  return [
    'Arcafold recovery key',
    '',
    'If you forget your password, these 12 words are the only way back into your photos.',
    'Keep this file somewhere safe and private, or print it and delete the file.',
    'Anyone with these words and your email can open your library.',
    '',
    ...numbered,
    '',
  ].join('\n');
}
