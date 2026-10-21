import { describe, expect, it } from 'vitest';

import { prerender } from './prerender';

const files = prerender('https://photos.example.com', '2026-10-21');

function file(name: string) {
  const found = files.find((candidate) => candidate.file === name);
  if (!found) throw new Error(`${name} was not prerendered`);
  return found;
}

describe('prerender', () => {
  it('writes the public pages, the sitemap and robots.txt', () => {
    expect(files.map((candidate) => candidate.file)).toEqual([
      'index.html',
      'privacy.html',
      'terms.html',
      'sitemap.xml',
      'robots.txt',
    ]);
  });

  it('renders the landing page with its sections and the sharing example', () => {
    const { content, head } = file('index.html');
    expect(content).toContain('Truly private.');
    expect(content).toContain('One unlock screen. Two separate spaces.');
    expect(content).toContain('Shared with Estrella');
    expect(content).toContain('href="/privacy"');
    expect(content).toContain('href="/terms"');
    expect(head).toContain('<title>Twofold · End-to-end encrypted photo library</title>');
  });

  it('renders the legal pages, with a placeholder for the missing jurisdiction', () => {
    expect(file('privacy.html').content).toContain('<h1 class="legal__title">Privacy Policy</h1>');
    expect(file('terms.html').content).toContain('<h1 class="legal__title">Terms of Use</h1>');
    expect(file('terms.html').content).toContain('[jurisdiction]');
  });
});
