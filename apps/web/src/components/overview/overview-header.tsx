'use client';

import type { HolderChip } from '@webapp/components/page-header-context';
import { Topbar } from '@webapp/components/topbar';

export type { HolderChip };

export interface OverviewHeaderProps {
  poolId: string;
  title: string;
  holders: readonly HolderChip[];
  /** Whether the caller may record movements; viewers do not get the "+ Transação" button. */
  canAddTransaction: boolean;
}

/** The overview's header: the shared page header with the data the page already loaded. */
export function OverviewHeader({ poolId, title, holders, canAddTransaction }: OverviewHeaderProps) {
  return <Topbar title={title} header={{ poolId, holders, canAddTransaction }} />;
}
