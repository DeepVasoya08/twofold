/**
 * The recovery key as a text file, saved to the person's own device when they say they've
 * saved it. It's made here and never sent anywhere.
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

/** The recovery key as a file, ready to download. */
export function recoveryFile(words: readonly string[]): File {
  return new File([recoveryFileText(words)], RECOVERY_FILE_NAME, { type: 'text/plain' });
}
