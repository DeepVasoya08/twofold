import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import { Icon } from './Icon';

import './dialog.css';

interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md';
}

/** Modal built on <dialog>, which gives focus trapping, Escape and the backdrop for free. */
export function Dialog({ open, title, description, onClose, children, size = 'sm' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog__body">
        <header className="dialog__header">
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        {description && (
          <p className="dialog__description" id={descriptionId}>
            {description}
          </p>
        )}
        {open && children}
      </div>
    </dialog>
  );
}
