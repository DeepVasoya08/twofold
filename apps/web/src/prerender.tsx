import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MemoryRouter } from './app/router';
import { Privacy } from './screens/Privacy';
import { Terms } from './screens/Terms';
import { Welcome } from './screens/Welcome';
import { headTags, robotsTxt, sitemapXml } from './site/head';
import { publicPages } from './site/pages';
import type { PublicRoute } from './site/pages';

export { defaultSiteUrl } from './site/head';

/**
 * Build-time entry (see scripts/prerender.mjs): the public pages as static HTML, so search
 * engines and link previews see real content and tags without running the app.
 */

const screens: Record<PublicRoute, () => ReactNode> = {
  welcome: () => <Welcome />,
  privacy: () => <Privacy />,
  terms: () => <Terms />,
};

export interface PrerenderedFile {
  file: string;
  /** Tags for <head>, replacing the shell's <title>. Absent for files that aren't pages. */
  head?: string;
  /** The page's markup inside #root, or the whole file when there's no head. */
  content: string;
}

export function prerender(siteUrl: string, lastModified: string): PrerenderedFile[] {
  return [
    ...publicPages.map((page) => ({
      file: page.file,
      head: headTags(page, siteUrl),
      content: renderToStaticMarkup(
        <MemoryRouter initialPath={page.path}>{screens[page.route]()}</MemoryRouter>,
      ),
    })),
    { file: 'sitemap.xml', content: sitemapXml(publicPages, siteUrl, lastModified) },
    { file: 'robots.txt', content: robotsTxt(siteUrl) },
  ];
}
