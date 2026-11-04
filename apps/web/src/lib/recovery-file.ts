import { RECOVERY_FILE_NAME, recoveryFileText } from '@arcafold/core/recovery-file';

export { RECOVERY_FILE_NAME };

/** The recovery key as a file, ready to download. */
export function recoveryFile(words: readonly string[]): File {
  return new File([recoveryFileText(words)], RECOVERY_FILE_NAME, { type: 'text/plain' });
}
