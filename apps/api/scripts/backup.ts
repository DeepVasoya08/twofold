/**
 * Database backup tool. Run with `pnpm --filter @arcafold/api backup <command>`.
 *
 *   keygen <secret-key-file>              Makes a backup key pair. Writes the secret key to
 *                                         the file (never printed) and prints the public key.
 *   seal <input> <output>                 Seals a database export to BACKUP_PUBLIC_KEY.
 *   open <input> <output> <secret-key-file>
 *                                         Opens a sealed export with the offline secret key.
 *
 * See docs/backups.md for where each step runs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { newBackupKeyPair, openBackup, sealBackup } from '@arcafold/crypto/backup';

const USAGE = `Usage:
  backup keygen <secret-key-file>
  backup seal <input> <output>        (needs BACKUP_PUBLIC_KEY)
  backup open <input> <output> <secret-key-file>
`;

export class UsageError extends Error {
  override name = 'UsageError';
}

/** Makes a key pair, saves the secret key (readable by its owner only), returns the public key. */
export async function keygen(secretKeyFile: string): Promise<string> {
  const keys = await newBackupKeyPair();
  // 'wx' refuses to overwrite: replacing a secret key would make older backups unreadable.
  await writeFile(secretKeyFile, `${keys.secretKey}\n`, { flag: 'wx', mode: 0o600 });
  return keys.publicKey;
}

export async function seal(publicKey: string, input: string, output: string): Promise<void> {
  await writeFile(output, await sealBackup(publicKey, await readFile(input)));
}

export async function open(secretKeyFile: string, input: string, output: string): Promise<void> {
  const secretKey = await readFile(secretKeyFile, 'utf8');
  await writeFile(output, await openBackup(secretKey, await readFile(input)), { mode: 0o600 });
}

/** Runs one command; returns what to print. */
export async function run(args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  const [command, ...rest] = args;
  if (command === 'keygen' && rest.length === 1 && rest[0]) {
    const publicKey = await keygen(rest[0]);
    return `Secret key saved to ${rest[0]}. Keep it offline; it never goes to GitHub or Cloudflare.\nPublic key (set as the BACKUP_PUBLIC_KEY repository variable):\n${publicKey}\n`;
  }
  if (command === 'seal' && rest.length === 2 && rest[0] && rest[1]) {
    const publicKey = env.BACKUP_PUBLIC_KEY;
    if (!publicKey) throw new UsageError('BACKUP_PUBLIC_KEY is not set.');
    await seal(publicKey, rest[0], rest[1]);
    return `Sealed ${rest[0]} to ${rest[1]}.\n`;
  }
  if (command === 'open' && rest.length === 3 && rest[0] && rest[1] && rest[2]) {
    await open(rest[2], rest[0], rest[1]);
    return `Opened ${rest[0]} to ${rest[1]}.\n`;
  }
  throw new UsageError(USAGE);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.stdout.write(await run(process.argv.slice(2), process.env));
  } catch (error) {
    // Only the error's message: it never includes key material.
    console.error(error instanceof Error ? error.message : 'Backup command failed.');
    process.exitCode = 1;
  }
}
