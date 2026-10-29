import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { Icon } from '../components/Icon';

import './toast.css';

/** A button on a toast, such as Undo. Using it closes the toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastValue {
  show: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const TOAST_MS = 2600;
/** Long enough to reach for its button. */
const ACTION_TOAST_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    action?: ToastAction | undefined;
  } | null>(null);
  const nextId = useRef(0);

  const show = useCallback((message: string, action?: ToastAction) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, action });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => {
        setToast(null);
      },
      toast.action ? ACTION_TOAST_MS : TOAST_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <Icon name="check" size={18} />
            {toast.message}
            {toast.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastValue {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used inside ToastProvider');
  return toast;
}
