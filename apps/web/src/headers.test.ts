import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** The directives of the Content-Security-Policy that `public/_headers` gives every page. */
function pagePolicy(): Map<string, string[]> {
  const headers = readFileSync(join(import.meta.dirname, '../public/_headers'), 'utf8');
  const policy = /^\s+Content-Security-Policy:\s*(.+)$/m.exec(headers)?.[1];
  if (policy === undefined) throw new Error('public/_headers sets no Content-Security-Policy');
  return new Map(
    policy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter((words) => words[0])
      .map(([name = '', ...sources]) => [name, sources]),
  );
}

describe('the pages’ Content-Security-Policy', () => {
  const policy = pagePolicy();

  it('runs only the app’s own scripts, plus WebAssembly for libsodium', () => {
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('lets no added script run: no inline code, no eval, no analytics hosts', () => {
    // Cloudflare can add its Web Analytics beacon and an inline bot-detection script to
    // every page; this policy is what keeps them from running.
    for (const [name, sources] of policy) {
      expect(sources, name).not.toContain("'unsafe-inline'");
      expect(sources, name).not.toContain("'unsafe-eval'");
      expect(sources, name).not.toContain("'unsafe-hashes'");
      expect(sources.join(' '), name).not.toMatch(
        /cloudflareinsights|google-analytics|googletagmanager|\*(?:\s|$)/,
      );
    }
  });
});
