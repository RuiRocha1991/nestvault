'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ShellApi {
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used inside <AppShell>');
  return context;
}

export const SIDEBAR_ID = 'sidebar';
export const MENU_BUTTON_ID = 'menu-button';

export interface AppShellProps {
  sidebar: ReactNode;
  scrimLabel: string;
  /** Label of the "skip to content" link, the first focusable element of the page. */
  skipLabel: string;
  children: ReactNode;
}

/** Holds the drawer state (≤ 860 px). On desktop the sidebar is always visible and this is inert. */
export function AppShell({ sidebar, scrimLabel, skipLabel, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const wasOpen = useRef(false);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  // Navigating closes the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) {
      // Give the focus back to the menu button after the drawer closes.
      if (wasOpen.current) document.getElementById(MENU_BUTTON_ID)?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    document.getElementById(SIDEBAR_ID)?.querySelector<HTMLElement>('a, button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  const api = useMemo(
    () => ({ drawerOpen, openDrawer, closeDrawer }),
    [drawerOpen, openDrawer, closeDrawer],
  );

  return (
    <ShellContext.Provider value={api}>
      <div className="grid min-h-screen grid-cols-[var(--sidebar-w)_minmax(0,1fr)] drawer:grid-cols-[minmax(0,1fr)]">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
        >
          {skipLabel}
        </a>
        {sidebar}
        {drawerOpen ? (
          <button
            type="button"
            aria-label={scrimLabel}
            tabIndex={-1}
            onClick={closeDrawer}
            className="fixed inset-0 z-30 hidden bg-[var(--overlay)] drawer:block"
          />
        ) : null}
        <div className="min-w-0 px-6 pb-10 pt-6 drawer:px-4">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}
