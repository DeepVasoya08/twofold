import { useEffect } from 'react';
import type { RefObject } from 'react';

import { useFind } from '../app/find';
import { useRouter } from '../app/router';
import { paths } from '../app/routes';
import { Icon } from './Icon';

import '../screens/search.css';

/** Whether a key press is someone typing into a field, rather than a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * The search field at the top of every signed-in screen. Searching from anywhere opens the
 * results; what was typed stays in memory only, never in the URL. "/" jumps to it.
 */
export function SearchBar({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const find = useFind();
  const { pathname, navigate } = useRouter();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [inputRef]);

  return (
    <form
      role="search"
      className="search-box"
      onSubmit={(event) => {
        event.preventDefault();
        find.submit();
        if (pathname !== paths.search) navigate(paths.search);
      }}
    >
      <Icon name="search" size={18} />
      <input
        ref={inputRef}
        type="search"
        className="search-box__input"
        aria-label="Search your photos and files"
        placeholder="Try “beach”, “Estrella last year” or “us in December”"
        value={find.text}
        maxLength={300}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(event) => {
          find.setText(event.currentTarget.value);
        }}
      />
      <button type="submit" className="btn btn--ink btn--sm">
        Search
      </button>
    </form>
  );
}
