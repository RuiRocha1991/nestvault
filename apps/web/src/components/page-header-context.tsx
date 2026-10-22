'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface HolderChip {
  id: string;
  name: string;
  color: string;
}

/** What the page header needs from the pool: its id, the household's people and the permission. */
export interface PageHeaderData {
  poolId: string;
  holders: readonly HolderChip[];
  /** Whether the caller may record movements; viewers do not get the "+ Transação" button. */
  canAddTransaction: boolean;
}

const PageHeaderContext = createContext<PageHeaderData | null>(null);

/** Set once by the app frame, so every page's header shows the real search, action and people. */
export function PageHeaderProvider({
  value,
  children,
}: {
  value: PageHeaderData;
  children: ReactNode;
}) {
  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

export const usePageHeader = (): PageHeaderData | null => useContext(PageHeaderContext);
