'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ToastItem {
  id: number;
  message: string;
}

interface ToastApi {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string) => {
    const id = nextId.current++;
    setItems((current) => [...current, { id, message }]);
    setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, TOAST_MS);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[60] flex max-w-[calc(100%-32px)] flex-col gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-md bg-fg px-3.5 py-2.5 text-md font-semibold text-bg shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
