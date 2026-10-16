import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';

interface RouterValue {
  pathname: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  back: (fallback: string) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

const NAVIGATE_EVENT = 'twofold:navigate';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

function currentHref(): string {
  return window.location.pathname + window.location.search;
}

function splitHref(href: string): { pathname: string; search: string } {
  const index = href.indexOf('?');
  return index === -1
    ? { pathname: href, search: '' }
    : { pathname: href.slice(0, index), search: href.slice(index) };
}

/** Router backed by the History API. The Worker serves index.html for every app path. */
export function BrowserRouter({ children }: { children: ReactNode }) {
  const href = useSyncExternalStore(subscribe, currentHref, () => '/');

  const value = useMemo<RouterValue>(() => {
    const navigate: RouterValue['navigate'] = (to, options) => {
      if (to === currentHref()) return;
      if (options?.replace) window.history.replaceState(null, '', to);
      else window.history.pushState({ inApp: true }, '', to);
      window.dispatchEvent(new Event(NAVIGATE_EVENT));
      window.scrollTo({ top: 0 });
    };
    const back: RouterValue['back'] = (fallback) => {
      const state: unknown = window.history.state;
      const cameFromApp =
        typeof state === 'object' && state !== null && 'inApp' in state && state.inApp === true;
      if (cameFromApp) window.history.back();
      else navigate(fallback, { replace: true });
    };
    return { ...splitHref(href), navigate, back };
  }, [href]);

  return <RouterContext value={value}>{children}</RouterContext>;
}

/** In-memory router for tests and server rendering. */
export function MemoryRouter({
  initialPath,
  children,
}: {
  initialPath: string;
  children: ReactNode;
}) {
  const [href, setHref] = useState(initialPath);
  const navigate = useCallback((to: string) => {
    setHref(to);
  }, []);
  const value = useMemo<RouterValue>(
    () => ({ ...splitHref(href), navigate, back: navigate }),
    [href, navigate],
  );
  return <RouterContext value={value}>{children}</RouterContext>;
}

export function useRouter(): RouterValue {
  const router = useContext(RouterContext);
  if (!router) throw new Error('useRouter must be used inside a router');
  return router;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  replace?: boolean;
};

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  return (
    <a
      {...rest}
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainLeftClick(event)) return;
        event.preventDefault();
        navigate(to, replace ? { replace } : undefined);
      }}
    />
  );
}
