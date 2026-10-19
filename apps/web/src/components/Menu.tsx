import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from './Icon';
import type { IconName } from './Icon';

import './menu.css';

export interface MenuItem {
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
}

/** A "more" button that opens a short list of actions. Escape or a click outside closes it. */
export function Menu({
  label,
  items,
  className,
}: {
  /** The button's accessible name, such as "Album actions". */
  label: string;
  items: readonly MenuItem[];
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={`menu${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="menu__button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <Icon name="more" />
      </button>
      {open && (
        <ul className="menu__list" id={menuId} role="menu" aria-label={label}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
