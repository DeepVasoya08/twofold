import { describe, expect, it } from 'vitest';

import { SHELL_URL, entryScriptIn, isNewerBuildLive, loadedEntryScript } from './app-version';

const shell = (src: string) =>
  `<!doctype html><head><script>var x</script><script type="module" crossorigin src="${src}"></script></head>`;

function answering(body: string, status = 200): typeof fetch {
  return (input) => {
    expect(input).toBe(SHELL_URL);
    return Promise.resolve(new Response(body, { status }));
  };
}

describe('entryScriptIn', () => {
  it('finds the module script', () => {
    expect(entryScriptIn(shell('/assets/index-B.js'))).toBe('/assets/index-B.js');
  });

  it('is null without one', () => {
    expect(entryScriptIn('<script src="/x.js"></script>')).toBeNull();
    expect(entryScriptIn('Not found')).toBeNull();
  });
});

describe('loadedEntryScript', () => {
  it('reads the page’s own entry script', () => {
    const page = (src: string | null) => ({
      querySelector: (selector: string) => {
        expect(selector).toBe('script[type="module"][src]');
        return src === null ? null : ({ getAttribute: () => src } as unknown as Element);
      },
    });
    expect(loadedEntryScript(page('/assets/index-A.js'))).toBe('/assets/index-A.js');
    expect(loadedEntryScript(page(null))).toBeNull();
  });
});

describe('isNewerBuildLive', () => {
  it('is true when the live shell names another entry script', async () => {
    await expect(
      isNewerBuildLive('/assets/index-A.js', answering(shell('/assets/index-B.js'))),
    ).resolves.toBe(true);
  });

  it('is false for the same build', async () => {
    await expect(
      isNewerBuildLive('/assets/index-A.js', answering(shell('/assets/index-A.js'))),
    ).resolves.toBe(false);
  });

  it('is false when it can’t tell', async () => {
    await expect(isNewerBuildLive(null, answering(shell('/assets/index-B.js')))).resolves.toBe(
      false,
    );
    await expect(
      isNewerBuildLive('/assets/index-A.js', answering(shell('/assets/index-B.js'), 503)),
    ).resolves.toBe(false);
    await expect(isNewerBuildLive('/assets/index-A.js', answering('<p>offline</p>'))).resolves.toBe(
      false,
    );
    await expect(
      isNewerBuildLive('/assets/index-A.js', () => Promise.reject(new TypeError('offline'))),
    ).resolves.toBe(false);
  });
});
