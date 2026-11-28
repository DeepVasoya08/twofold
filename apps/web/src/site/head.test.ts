import { describe, expect, it } from 'vitest';

import { faq } from './faq';
import { headTags, normalizeSiteUrl, robotsTxt, securityTxt, sitemapXml } from './head';
import { publicPage, publicPages } from './pages';

const site = 'https://photos.example.com/';

function jsonLd(head: string): unknown[] {
  return [...head.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1] ?? 'null') as unknown,
  );
}

describe('headTags', () => {
  it('gives every public page its own title, description and canonical URL', () => {
    for (const page of publicPages) {
      const head = headTags(page, site);
      expect(head).toContain(`<title>${page.title}</title>`);
      expect(head).toContain(`<meta name="description" content="${page.description}" />`);
      expect(head).toContain(
        `<link rel="canonical" href="https://photos.example.com${page.path}" />`,
      );
      expect(head).toContain(
        `<meta property="og:url" content="https://photos.example.com${page.path}" />`,
      );
    }
  });

  it('has a large link preview card with an absolute image URL', () => {
    const head = headTags(publicPage('welcome'), site);
    expect(head).toContain(
      '<meta property="og:image" content="https://photos.example.com/og-image.png" />',
    );
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('describes the app and its questions as structured data on the landing page', () => {
    const data = jsonLd(headTags(publicPage('welcome'), site));
    expect(data.map((item) => (item as { '@type': string })['@type'])).toEqual([
      'WebSite',
      'WebApplication',
      'FAQPage',
    ]);
    const faqPage = data[2] as { mainEntity: { name: string }[] };
    expect(faqPage.mainEntity.map((question) => question.name)).toEqual(
      faq.map((item) => item.question),
    );
  });

  it('escapes text so it cannot break out of attributes or the script element', () => {
    const page = {
      ...publicPage('welcome'),
      title: 'A "quoted" <title>',
      description: '</script><script>alert(1)</script>',
    };
    const head = headTags(page, site);
    expect(head).toContain('content="A &quot;quoted&quot; &lt;title&gt;"');
    expect(head).not.toContain('<script>alert(1)');
    expect(head).toContain('\\u003c/script>');
  });
});

describe('site URL', () => {
  it('keeps only the origin', () => {
    expect(normalizeSiteUrl('https://photos.example.com/some/path?q=1')).toBe(
      'https://photos.example.com',
    );
  });

  it('refuses anything but http(s)', () => {
    expect(() => normalizeSiteUrl('javascript:alert(1)')).toThrow(/SITE_URL/);
    expect(() => normalizeSiteUrl('not a url')).toThrow();
  });
});

describe('sitemap and robots.txt', () => {
  it('lists every public page', () => {
    const xml = sitemapXml(publicPages, site, '2026-10-21');
    expect(xml).toContain('<loc>https://photos.example.com/</loc>');
    expect(xml).toContain('<loc>https://photos.example.com/privacy</loc>');
    expect(xml).toContain('<loc>https://photos.example.com/terms</loc>');
    expect(xml.match(/<lastmod>2026-10-21<\/lastmod>/g)).toHaveLength(publicPages.length);
  });

  it('keeps crawlers out of the API and points them at the sitemap', () => {
    expect(robotsTxt(site)).toBe(
      'User-agent: *\nDisallow: /api/\n\nSitemap: https://photos.example.com/sitemap.xml\n',
    );
  });
});

describe('security.txt', () => {
  it('says where to report a problem, and runs out within a year of the build', () => {
    expect(securityTxt(site, 'security@example.com', '2026-11-28')).toBe(
      [
        'Contact: mailto:security@example.com',
        'Expires: 2027-11-23T00:00:00.000Z',
        'Preferred-Languages: en',
        'Canonical: https://photos.example.com/.well-known/security.txt',
        '',
      ].join('\n'),
    );
  });

  it('refuses a contact or date it can’t use', () => {
    expect(() => securityTxt(site, 'not an address', '2026-11-28')).toThrow(/email address/);
    expect(() => securityTxt(site, 'a@b.c\nContact: mailto:x@evil.test', '2026-11-28')).toThrow();
    expect(() => securityTxt(site, 'security@example.com', 'soon')).toThrow(/date/);
  });
});
