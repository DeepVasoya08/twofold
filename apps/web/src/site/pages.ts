import { paths } from '../app/routes';
import type { Route } from '../app/routes';

/** A page anyone can read without an account, which search engines may index. */
export type PublicRoute = Extract<Route['name'], 'welcome' | 'privacy' | 'terms'>;

export interface PublicPage {
  route: PublicRoute;
  path: string;
  /** The tab and search result title. */
  title: string;
  /** The search result snippet and link preview text: about 150 characters. */
  description: string;
  /** The file the page is prerendered to, served at `path` (see scripts/prerender.mjs). */
  file: string;
}

export const publicPages: readonly PublicPage[] = [
  {
    route: 'welcome',
    path: paths.welcome,
    title: 'Twofold · End-to-end encrypted photo library',
    description:
      'Back up and organize your photos with end-to-end encryption. A second password opens a separate private space, and sharing is on your terms.',
    file: 'index.html',
  },
  {
    route: 'privacy',
    path: paths.privacy,
    title: 'Privacy Policy · Twofold',
    description:
      'What Twofold can and can’t see, what we store to run your account, and how to delete it. Your photos are encrypted on your device before upload.',
    file: 'privacy.html',
  },
  {
    route: 'terms',
    path: paths.terms,
    title: 'Terms of Use · Twofold',
    description:
      'The terms for using Twofold, including how your encryption keys, recovery key and storage work, and what you agree not to use it for.',
    file: 'terms.html',
  },
];

export function publicPage(route: PublicRoute): PublicPage {
  const page = publicPages.find((candidate) => candidate.route === route);
  if (!page) throw new Error(`No public page for ${route}`);
  return page;
}

/** Pages anyone can read, shown while the account is still loading, as they were prerendered. */
export function isPublicRoute(route: Route['name']): route is PublicRoute {
  return route === 'welcome' || route === 'privacy' || route === 'terms';
}
