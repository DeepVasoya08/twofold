import { describe, expect, it } from 'vitest';

import { RECOVERY_FILE_NAME, recoveryFileText } from '@arcafold/core/recovery-file';

import { recoveryFile } from './recovery-file';

const words = Array.from({ length: 12 }, (_, index) => `word${String(index + 1)}`);

describe('recoveryFile', () => {
  it('is a plain text file with a fixed name', async () => {
    const file = recoveryFile(words);
    expect(file.name).toBe(RECOVERY_FILE_NAME);
    expect(file.type).toBe('text/plain');
    expect(await file.text()).toBe(recoveryFileText(words));
  });
});
