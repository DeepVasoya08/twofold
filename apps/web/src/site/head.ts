import { faq } from './faq';
import type { PublicPage } from './pages';

/** Where the site is served when SITE_URL isn't set at build time. */
export const defaultSiteUrl = 'https://arcafold.deepvasoya08.workers.dev';

/** The social preview card in public/, rendered by scripts/render-images.mjs. */
export const ogImage = { path: '/og-image.png', width: 1200, height: 630 };

/** `https://example.com/` or `https://example.com` → `https://example.com`. */
export function normalizeSiteUrl(siteUrl: string): string {
  const url = new URL(siteUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SITE_URL must be an http(s) URL, got ${siteUrl}`);
  }
  return url.origin;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** JSON that can't close the script element it sits in. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function structuredData(page: PublicPage, origin: string): unknown[] {
  const url = origin + page.path;
  if (page.route !== 'welcome') {
    return [{ '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, url }];
  }
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Arcafold',
      url,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Arcafold',
      url,
      description: page.description,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any (runs in a web browser)',
      image: origin + ogImage.path,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
  ];
}

/** The <head> tags that describe a public page to search engines and link previews. */
export function headTags(page: PublicPage, siteUrl: string): string {
  const origin = normalizeSiteUrl(siteUrl);
  const url = origin + page.path;
  const image = origin + ogImage.path;
  const meta = (attribute: 'name' | 'property', key: string, content: string) =>
    `<meta ${attribute}="${key}" content="${escapeAttribute(content)}" />`;
  return [
    `<title>${escapeAttribute(page.title)}</title>`,
    meta('name', 'description', page.description),
    `<link rel="canonical" href="${escapeAttribute(url)}" />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', 'Arcafold'),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', String(ogImage.width)),
    meta('property', 'og:image:height', String(ogImage.height)),
    meta('property', 'og:image:alt', 'Arcafold: your photos, truly private.'),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', page.title),
    meta('name', 'twitter:description', page.description),
    meta('name', 'twitter:image', image),
    ...structuredData(page, origin).map(
      (data) => `<script type="application/ld+json">${jsonForScript(data)}</script>`,
    ),
  ].join('\n    ');
}

export function sitemapXml(pages: readonly PublicPage[], siteUrl: string, lastModified: string) {
  const origin = normalizeSiteUrl(siteUrl);
  const urls = pages.map(
    (page) =>
      `  <url>\n    <loc>${escapeAttribute(origin + page.path)}</loc>\n    <lastmod>${lastModified}</lastmod>\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Everything may be crawled except the API; app screens say noindex themselves. */
export function robotsTxt(siteUrl: string): string {
  const origin = normalizeSiteUrl(siteUrl);
  return `User-agent: *\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
}
